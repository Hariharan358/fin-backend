const { Router } = require("express");
const Borrower = require("../models/Borrower.cjs");
const Loan = require("../models/Loan.cjs");
const Agent = require("../models/Agent.cjs");
const Payment = require("../models/Payment.cjs");
const Task = require("../models/Task.cjs");

const router = Router();

// List all borrowers (optionally include loans with ?include=loans)
router.get("/borrowers", async (req, res) => {
    try {
        const include = (req.query.include || "").toString();
        const borrowers = await Borrower.find({}).sort({ createdAt: -1 });
        if (include === "loans") {
            const borrowerIds = borrowers.map((b) => b._id);
            const loans = await Loan.find({ borrowerId: { $in: borrowerIds } });
            const borrowerIdToLoans = new Map();
            for (const loan of loans) {
                const key = loan.borrowerId.toString();
                if (!borrowerIdToLoans.has(key)) borrowerIdToLoans.set(key, []);
                borrowerIdToLoans.get(key).push(loan);
            }
            const withLoans = borrowers.map((b) => ({
                ...b.toObject(),
                loans: borrowerIdToLoans.get(b._id.toString()) || [],
            }));
            return res.json(withLoans);
        }
        return res.json(borrowers);
    } catch (err) {
        return res.status(500).json({ error: err?.message || "Failed to fetch borrowers" });
    }
});

// Update a borrower
router.patch("/borrowers/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const update = req.body || {};
        // Whitelist allowed fields
        const allowed = [
            "name","firstName","lastName","email","phone","dateOfBirth",
            "address","city","state","pincode","assignedAgent","status"
        ];
        const safeUpdate = {};
        for (const key of allowed) {
            if (Object.prototype.hasOwnProperty.call(update, key)) {
                safeUpdate[key] = update[key];
            }
        }
        if (safeUpdate.dateOfBirth) safeUpdate.dateOfBirth = new Date(safeUpdate.dateOfBirth);
        const updated = await Borrower.findByIdAndUpdate(id, safeUpdate, { new: true });
        if (!updated) return res.status(404).json({ error: "Borrower not found" });
        return res.json(updated);
    } catch (err) {
        return res.status(500).json({ error: err?.message || "Failed to update borrower" });
    }
});

// Delete a borrower (and cascade delete loans and payments)
router.delete("/borrowers/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const borrower = await Borrower.findById(id);
        if (!borrower) return res.status(404).json({ error: "Borrower not found" });

        // Find loans for this borrower
        const loans = await Loan.find({ borrowerId: id }).select("_id");
        const loanIds = loans.map(l => l._id);

        // Remove payments tied to these loans and borrower
        await Payment.deleteMany({ $or: [ { borrowerId: id }, { loanId: { $in: loanIds } } ] });
        // Remove loans
        await Loan.deleteMany({ borrowerId: id });
        // Remove borrower
        await Borrower.findByIdAndDelete(id);

        return res.json({ message: "Borrower deleted successfully", borrowerId: id });
    } catch (err) {
        return res.status(500).json({ error: err?.message || "Failed to delete borrower" });
    }
});

// Agents: create
router.post("/agents", async (req, res) => {
    try {
        const { name, phone, email, status } = req.body || {};
        let { agentId } = req.body || {};
        if (!name) return res.status(400).json({ error: "name is required" });

        // Auto-generate agentId if not provided: e.g., AG123456
        if (!agentId) {
            const genId = async () => `AG${Math.floor(100000 + Math.random() * 900000)}`;
            for (let i = 0; i < 5; i++) {
                const candidate = await genId();
                const exists = await Agent.exists({ agentId: candidate });
                if (!exists) { agentId = candidate; break; }
            }
            if (!agentId) return res.status(500).json({ error: "Failed to generate unique agentId" });
        }

        const created = await Agent.create({ name, agentId, phone, email, status });
        return res.status(201).json(created);
    } catch (err) {
        return res.status(500).json({ error: err?.message || "Failed to create agent" });
    }
});

// Agents: list
router.get("/agents", async (_req, res) => {
    try {
        const agents = await Agent.find({}).sort({ createdAt: -1 });
        return res.json(agents);
    } catch (err) {
        return res.status(500).json({ error: err?.message || "Failed to fetch agents" });
    }
});

// Get a single borrower with all details and loans
router.get("/borrowers/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const borrower = await Borrower.findById(id);
        if (!borrower) return res.status(404).json({ error: "Borrower not found" });
        const loans = await Loan.find({ borrowerId: id }).sort({ createdAt: -1 });
        return res.json({ ...borrower.toObject(), loans });
    } catch (err) {
        return res.status(500).json({ error: err?.message || "Failed to fetch borrower" });
    }
});

// Create a new borrower
router.post("/borrowers", async (req, res) => {
	try {
		const body = req.body || {};
		console.log("POST /api/manager/borrowers incoming:", body);
		const firstName = (body.firstName ?? "").toString().trim();
		const lastName = (body.lastName ?? "").toString().trim();
		const phoneNumber = (body.phoneNumber ?? body.phone ?? "").toString().trim();
		const email = ((body.email ?? "").toString().trim()) || undefined;

		const candidates = [
			(body.name ?? "").toString().trim(),
			[firstName, lastName].filter(Boolean).join(" "),
			firstName,
			lastName,
			phoneNumber,
			"Borrower",
		];
		const name = candidates.find((v) => !!v) || "Borrower";
		const created = await Borrower.create({
			name,
			firstName,
			lastName,
			email,
			phone: phoneNumber || undefined,
			dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
			address: body.address,
			city: body.city,
			state: body.state,
			pincode: body.pincode,
			assignedAgent: body.assignedAgent,
		});

		// Optionally create a loan if form sent loan details
		const amount = Number(body.loanAmount);
		const interestRatePercent = Number(body.interestRate);
		const tenureMonths = Number(body.tenure);
		const frequency = body.frequency;
		const purpose = body.purpose;
		const assignedAgent = body.assignedAgent;
		if (amount && !Number.isNaN(amount)) {
			await Loan.create({
				borrowerId: created._id,
				amount,
				remainingAmount: amount, // Initially, remaining amount equals total amount
				totalPaid: 0, // No payments made yet
				interestRatePercent: Number.isNaN(interestRatePercent) ? undefined : interestRatePercent,
				tenureMonths: Number.isNaN(tenureMonths) ? undefined : tenureMonths,
				frequency,
				purpose,
				assignedAgent,
				status: "active",
			});
		}
		console.log("Created borrower:", created?._id?.toString?.() || created);
		return res.status(201).json(created);
	} catch (err) {
		return res.status(500).json({ error: err?.message || "Failed to create borrower" });
	}
});

// Alias: accept singular path as well
router.post("/borrower", async (req, res) => {
	try {
		const body = req.body || {};
		console.log("POST /api/manager/borrower incoming:", body);
		const firstName = (body.firstName ?? "").toString().trim();
		const lastName = (body.lastName ?? "").toString().trim();
		const phoneNumber = (body.phoneNumber ?? body.phone ?? "").toString().trim();
		const email = ((body.email ?? "").toString().trim()) || undefined;

		const candidates = [
			(body.name ?? "").toString().trim(),
			[firstName, lastName].filter(Boolean).join(" "),
			firstName,
			lastName,
			phoneNumber,
			"Borrower",
		];
		const name = candidates.find((v) => !!v) || "Borrower";
		const created = await Borrower.create({
			name,
			firstName,
			lastName,
			email,
			phone: phoneNumber || undefined,
			dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
			address: body.address,
			city: body.city,
			state: body.state,
			pincode: body.pincode,
			assignedAgent: body.assignedAgent,
		});

		// Optionally create a loan if form sent loan details
		const amount = Number(body.loanAmount);
		const interestRatePercent = Number(body.interestRate);
		const tenureMonths = Number(body.tenure);
		const frequency = body.frequency;
		const purpose = body.purpose;
		const assignedAgent = body.assignedAgent;
		if (amount && !Number.isNaN(amount)) {
			await Loan.create({
				borrowerId: created._id,
				amount,
				remainingAmount: amount, // Initially, remaining amount equals total amount
				totalPaid: 0, // No payments made yet
				interestRatePercent: Number.isNaN(interestRatePercent) ? undefined : interestRatePercent,
				tenureMonths: Number.isNaN(tenureMonths) ? undefined : tenureMonths,
				frequency,
				purpose,
				assignedAgent,
				status: "active",
			});
		}
		console.log("Created borrower:", created?._id?.toString?.() || created);
		return res.status(201).json(created);
	} catch (err) {
		return res.status(500).json({ error: err?.message || "Failed to create borrower" });
	}
});

router.get("/kpis", async (_req, res) => {
	try {
		const now = new Date();
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		const [totalBorrowers, activeLoans, disbursedAgg, repaymentsAgg] = await Promise.all([
			Borrower.countDocuments({}),
			Loan.countDocuments({ status: "active" }),
			Loan.aggregate([
				{ $match: { status: { $ne: "cancelled" } } },
				{ $group: { _id: null, total: { $sum: "$amount" } } },
			]),
			Payment.aggregate([
				{ $match: { created_at: { $gte: startOfMonth } } },
				{ $group: { _id: null, total: { $sum: "$amount" } } },
			]),
		]);

		const totalDisbursed = disbursedAgg[0]?.total || 0;
		const repaymentsThisMonth = repaymentsAgg[0]?.total || 0;

		res.json({ totalBorrowers, activeLoans, totalDisbursed, repaymentsThisMonth });
	} catch (err) {
		res.status(500).json({ error: err?.message || "Failed to fetch KPIs" });
	}
});

router.get("/loans", async (req, res) => {
	try {
		const status = req.query.status;
		const filter = {};
		if (status) filter.status = status;
		const loans = await Loan.find(filter).sort({ createdAt: -1 }).select("_id borrowerId amount status createdAt");
		res.json(loans);
	} catch (err) {
		res.status(500).json({ error: err?.message || "Failed to fetch loans" });
	}
});

router.post("/loans/:id/approve", async (req, res) => {
	try {
		const { id } = req.params;
		const { approved, comment } = req.body || {};
		if (typeof approved !== "boolean") {
			return res.status(400).json({ error: "approved must be a boolean" });
		}
		const status = approved ? "approved" : "rejected";
		await Loan.updateOne({ _id: id }, { $set: { status, manager_comment: comment || null } });
		res.json({ id, status });
	} catch (err) {
		res.status(500).json({ error: err?.message || "Failed to update loan" });
	}
});

// Agent authentication
router.post("/auth/agent", async (req, res) => {
	try {
		const { mobile, agentId } = req.body || {};
		if (!mobile || !agentId) {
			return res.status(400).json({ error: "Mobile number and Agent ID are required" });
		}

		const agent = await Agent.findOne({ 
			phone: mobile.toString().trim(), 
			agentId: agentId.toString().trim() 
		});

		if (!agent) {
			return res.status(401).json({ error: "Invalid credentials" });
		}

		// Return agent data (excluding sensitive info)
		const { _id, name, agentId: id, phone, email, status } = agent;
		return res.json({
			success: true,
			agent: { _id, name, agentId: id, phone, email, status },
			message: "Login successful"
		});
	} catch (err) {
		return res.status(500).json({ error: err?.message || "Login failed" });
	}
});

// Get agent-specific borrowers (only approved ones)
router.get("/agent/:agentId/borrowers", async (req, res) => {
	try {
		const { agentId } = req.params;
		console.log(`Fetching approved borrowers for agent: ${agentId}`);
		
		// Find borrowers assigned to this agent with approved status
		const borrowers = await Borrower.find({ 
			assignedAgent: agentId,
			approvalStatus: "approved" 
		}).sort({ createdAt: -1 });
		
		console.log(`Found ${borrowers.length} approved borrowers for agent ${agentId}`);
		return res.json(borrowers);
	} catch (err) {
		console.error('Error fetching agent borrowers:', err);
		return res.status(500).json({ error: err?.message || "Failed to fetch borrowers" });
	}
});

// Get agent-specific loans
router.get("/agent/:agentId/loans", async (req, res) => {
	try {
		const { agentId } = req.params;
		let loans = await Loan.find({ assignedAgent: agentId })
			.populate('borrowerId', 'name firstName lastName phone email')
			.sort({ createdAt: -1 });
		
		// Migrate existing loans that don't have remainingAmount and totalPaid fields
		const loansToUpdate = loans.filter(loan => 
			loan.remainingAmount === undefined || loan.totalPaid === undefined
		);
		
		if (loansToUpdate.length > 0) {
			console.log(`Migrating ${loansToUpdate.length} loans to new payment tracking format`);
			
			for (const loan of loansToUpdate) {
				// Calculate total payments for this loan (excluding reversed)
				const totalPayments = await Payment.aggregate([
					{ $match: { loanId: loan._id, reversed: { $ne: true } } },
					{ $group: { _id: null, total: { $sum: "$amount" } } }
				]);
				
				const totalPaid = totalPayments[0]?.total || 0;
				const remainingAmount = Math.max(loan.amount - totalPaid, 0);
				
				await Loan.findByIdAndUpdate(loan._id, {
					remainingAmount,
					totalPaid,
					status: remainingAmount <= 0 ? "paid" : loan.status
				});
			}
			
			// Fetch updated loans
			loans = await Loan.find({ assignedAgent: agentId })
				.populate('borrowerId', 'name firstName lastName phone email')
				.sort({ createdAt: -1 });
		}
		
		return res.json(loans);
	} catch (err) {
		return res.status(500).json({ error: err?.message || "Failed to fetch loans" });
	}
});

// Generate today's repayment tasks for an agent based on loan schedules (monthly)
router.get("/agent/:agentId/repayment-tasks-today", async (req, res) => {
    try {
        const { agentId } = req.params;
        const { force } = req.query;
        const today = new Date();
        today.setHours(0,0,0,0);
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        // Fetch active loans for this agent
        const loans = await Loan.find({ assignedAgent: agentId, status: { $in: ["active", "approved"] } })
            .populate('borrowerId', 'name firstName lastName phone address city state pincode');

        // Helper to add months safely
        const addMonths = (date, months) => {
            const d = new Date(date.getTime());
            const day = d.getDate();
            d.setDate(1);
            d.setMonth(d.getMonth() + months);
            const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            d.setDate(Math.min(day, lastDay));
            d.setHours(0,0,0,0);
            return d;
        };

        const tasks = [];

        for (const loan of loans) {
            if (loan.frequency !== 'monthly' || !loan.tenureMonths) continue;
            const start = new Date(loan.createdAt || loan._id.getTimestamp());
            start.setHours(0,0,0,0);

            for (let i = 1; i <= loan.tenureMonths; i++) {
                const due = addMonths(start, i);
                // If ?force=true, treat all loans as due today for testing
                if ((force === 'true') || (due >= today && due < tomorrow)) {
                    const borrowerName = loan.borrowerId?.name || `${loan.borrowerId?.firstName || ''} ${loan.borrowerId?.lastName || ''}`.trim() || 'Borrower';
                    const syntheticId = `${loan._id.toString()}-${due.toISOString().slice(0,10)}`;
                    const addressParts = [
                        loan.borrowerId?.address,
                        loan.borrowerId?.city,
                        loan.borrowerId?.state,
                        loan.borrowerId?.pincode
                    ].filter(Boolean);
                    const locationAddress = addressParts.join(', ');
                    const locationUrl = locationAddress ? `https://maps.google.com?q=${encodeURIComponent(locationAddress)}` : undefined;
                    tasks.push({
                        _id: syntheticId,
                        agentId,
                        title: `Collect EMI from ${borrowerName}`,
                        description: `Loan: ₹${(loan.amount || 0).toLocaleString()} • EMI ${i}/${loan.tenureMonths}`,
                        dueDate: due.toISOString(),
                        status: 'pending',
                        createdAt: today.toISOString(),
                        locationAddress,
                        locationUrl,
                    });
                    break; // Only one due per loan per day
                }
            }
        }

        return res.json(tasks);
    } catch (err) {
        return res.status(500).json({ error: err?.message || "Failed to generate repayment tasks" });
    }
});

// Get agent-specific payments
router.get("/agent/:agentId/payments", async (req, res) => {
	try {
		const { agentId } = req.params;
		const { includeReversed } = req.query;
		
		let filter = { agentId };
		if (includeReversed !== 'true') {
			filter.reversed = { $ne: true }; // Exclude reversed payments by default
		}
		
		const payments = await Payment.find(filter).sort({ createdAt: -1 });
		return res.json(payments);
	} catch (err) {
		return res.status(500).json({ error: err?.message || "Failed to fetch payments" });
	}
});

// Create a new payment
router.post("/payments", async (req, res) => {
	try {
		const { borrowerId, loanId, agentId, amount, paymentMode, location, receiptName } = req.body || {};
		
		console.log('POST /api/manager/payments received:', req.body);
		
		if (!borrowerId || !agentId || !amount) {
			return res.status(400).json({ error: "Borrower ID, Agent ID, and amount are required" });
		}

		// Verify borrower exists
		const borrower = await Borrower.findById(borrowerId);
		if (!borrower) {
			return res.status(400).json({ error: "Borrower not found" });
		}

		// Verify agent exists
		const agent = await Agent.findOne({ agentId });
		if (!agent) {
			return res.status(400).json({ error: "Agent not found" });
		}

		// Find the loan for this borrower (use the most recent active loan if loanId not provided)
		let loan;
		if (loanId) {
			loan = await Loan.findById(loanId);
		} else {
			loan = await Loan.findOne({ borrowerId, status: "active" }).sort({ createdAt: -1 });
		}
		
		console.log('Found loan for payment:', {
			loanId: loan?._id,
			borrowerId,
			loanAmount: loan?.amount,
			remainingAmount: loan?.remainingAmount,
			totalPaid: loan?.totalPaid,
			status: loan?.status,
			assignedAgent: loan?.assignedAgent
		});
		
		if (!loan) {
			return res.status(400).json({ error: "No active loan found for this borrower" });
		}

		const paymentData = {
			loanId: loan._id,
			borrowerId,
			agentId,
			amount: Number(amount),
			paymentMode: paymentMode || "cash",
			location: location ? {
				latitude: location.latitude,
				longitude: location.longitude
			} : undefined,
			receiptName: receiptName || undefined,
		};

		const createdPayment = await Payment.create(paymentData);
		
		// Update the loan amount after payment
		const paymentAmount = Number(amount);
		console.log('Updating loan with payment:', {
			loanId: loan._id,
			paymentAmount,
			currentRemaining: loan.remainingAmount,
			currentTotalPaid: loan.totalPaid
		});
		
		// Calculate total payments for this loan including the new payment (excluding reversed)
		const existingPayments = await Payment.aggregate([
			{ $match: { loanId: loan._id, reversed: { $ne: true } } },
			{ $group: { _id: null, total: { $sum: "$amount" } } }
		]);
		
		// Also get all payments for debugging
		const allPayments = await Payment.find({ loanId: loan._id });
		console.log('All payments for loan:', allPayments.map(p => ({
			id: p._id,
			amount: p.amount,
			reversed: p.reversed,
			createdAt: p.createdAt
		})));
		
		const totalPaid = Math.min(existingPayments[0]?.total || 0, loan.amount);
		const remainingAmount = Math.max(loan.amount - totalPaid, 0);
		const newStatus = remainingAmount <= 0 ? "paid" : loan.status;
		
		console.log('Calculating loan update:', {
			loanId: loan._id,
			originalAmount: loan.amount,
			totalPaid,
			remainingAmount,
			newStatus
		});
		
		// Update the loan with calculated values
		const updatedLoan = await Loan.findByIdAndUpdate(
			loan._id,
			{
				$set: {
					totalPaid,
					remainingAmount,
					status: newStatus
				}
			},
			{ new: true }
		);
		
		console.log('Loan updated successfully:', {
			loanId: updatedLoan._id,
			amount: updatedLoan.amount,
			remainingAmount: updatedLoan.remainingAmount,
			totalPaid: updatedLoan.totalPaid,
			status: updatedLoan.status
		});
		
		return res.status(201).json(createdPayment);
	} catch (err) {
		console.error('Payment creation error:', err);
		return res.status(500).json({ error: err?.message || "Failed to create payment" });
	}
});

// Get agent dashboard KPIs
router.get("/agent/:agentId/kpis", async (req, res) => {
	try {
		const { agentId } = req.params;
		
		// Get today's date range
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const tomorrow = new Date(today);
		tomorrow.setDate(today.getDate() + 1);
		
		// Get this month's date range
		const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
		const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

		// Today's collections
		const todayPayments = await Payment.find({
			agentId,
			createdAt: { $gte: today, $lt: tomorrow }
		});
		const todayCollections = todayPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

		// Active borrowers count
		const activeBorrowers = await Borrower.countDocuments({ 
			assignedAgent: agentId,
			status: "active" 
		});

		// Pending visits (loans with active status)
		const pendingVisits = await Loan.countDocuments({ 
			assignedAgent: agentId,
			status: "active" 
		});

		// This month's success rate (completed payments vs total loans)
		const thisMonthPayments = await Payment.find({
			agentId,
			createdAt: { $gte: thisMonth, $lt: nextMonth }
		});
		const thisMonthLoans = await Loan.countDocuments({
			assignedAgent: agentId,
			createdAt: { $gte: thisMonth, $lt: nextMonth }
		});
		const successRate = thisMonthLoans > 0 ? Math.round((thisMonthPayments.length / thisMonthLoans) * 100) : 0;

		return res.json({
			todayCollections,
			todayPaymentsCount: todayPayments.length,
			activeBorrowers,
			pendingVisits,
			successRate
		});
	} catch (err) {
		return res.status(500).json({ error: err?.message || "Failed to fetch KPIs" });
	}
});

// Task Management Endpoints

// Create a new task
router.post("/tasks", async (req, res) => {
	try {
		const { title, description, agentId, dueDate, priority, notes } = req.body || {};
		
		console.log('POST /api/manager/tasks received:', req.body);
		console.log('Extracted fields:', { title, description, agentId, dueDate, priority, notes });
		
		if (!title || !agentId || !dueDate) {
			return res.status(400).json({ error: "Title, agent ID, and due date are required" });
		}

		// Verify agent exists
		console.log('Looking for agent with agentId:', agentId);
		const agent = await Agent.findOne({ agentId });
		console.log('Found agent:', agent);
		
		if (!agent) {
			// Let's also check what agents exist
			const allAgents = await Agent.find({}).select('agentId name');
			console.log('Available agents:', allAgents);
			return res.status(400).json({ error: `Agent not found. Available agents: ${allAgents.map(a => a.agentId).join(', ')}` });
		}

		const taskData = {
			title,
			description: description || "",
			agentId,
			assignedBy: "manager", // In real app, get from auth context
			dueDate: new Date(dueDate),
			priority: priority || "medium",
			notes: notes || "",
		};

		const createdTask = await Task.create(taskData);
		return res.status(201).json(createdTask);
	} catch (err) {
		return res.status(500).json({ error: err?.message || "Failed to create task" });
	}
});

// Get all tasks
router.get("/tasks", async (req, res) => {
	try {
		const { agentId, status } = req.query;
		let filter = {};
		
		if (agentId) filter.agentId = agentId;
		if (status) filter.status = status;

		const tasks = await Task.find(filter)
			.populate('agentId', 'name agentId phone')
			.sort({ createdAt: -1 });
		
		return res.json(tasks);
	} catch (err) {
		return res.status(500).json({ error: err?.message || "Failed to fetch tasks" });
	}
});

// Get tasks for a specific agent
router.get("/agent/:agentId/tasks", async (req, res) => {
	try {
		const { agentId } = req.params;
		const { status } = req.query;
		
		let filter = { agentId };
		if (status) filter.status = status;

		const tasks = await Task.find(filter).sort({ dueDate: 1 });
		return res.json(tasks);
	} catch (err) {
		return res.status(500).json({ error: err?.message || "Failed to fetch agent tasks" });
	}
});

// Update task status
router.patch("/tasks/:taskId", async (req, res) => {
	try {
		const { taskId } = req.params;
		const { status, notes } = req.body || {};
		
		if (!status) {
			return res.status(400).json({ error: "Status is required" });
		}

		const updateData = { status };
		if (status === "completed") {
			updateData.completedAt = new Date();
		}
		if (notes) {
			updateData.notes = notes;
		}

		const updatedTask = await Task.findByIdAndUpdate(
			taskId, 
			updateData, 
			{ new: true }
		);

		if (!updatedTask) {
			return res.status(404).json({ error: "Task not found" });
		}

		return res.json(updatedTask);
	} catch (err) {
		return res.status(500).json({ error: err?.message || "Failed to update task" });
	}
});

// Delete task
router.delete("/tasks/:taskId", async (req, res) => {
	try {
		const { taskId } = req.params;
		
		const deletedTask = await Task.findByIdAndDelete(taskId);
		if (!deletedTask) {
			return res.status(404).json({ error: "Task not found" });
		}

		return res.json({ message: "Task deleted successfully" });
	} catch (err) {
		return res.status(500).json({ error: err?.message || "Failed to delete task" });
	}
});

// Test endpoint to manually update loan payment tracking
router.post("/loans/:loanId/init-payment-tracking", async (req, res) => {
	try {
		const { loanId } = req.params;
		
		const loan = await Loan.findById(loanId);
		if (!loan) {
			return res.status(404).json({ error: "Loan not found" });
		}
		
		// Calculate total payments for this loan
		const totalPayments = await Payment.aggregate([
			{ $match: { loanId: loan._id } },
			{ $group: { _id: null, total: { $sum: "$amount" } } }
		]);
		
		const totalPaid = totalPayments[0]?.total || 0;
		const remainingAmount = Math.max(loan.amount - totalPaid, 0);
		
		const updatedLoan = await Loan.findByIdAndUpdate(loanId, {
			remainingAmount,
			totalPaid,
			status: remainingAmount <= 0 ? "paid" : loan.status
		}, { new: true });
		
		console.log('Manually updated loan payment tracking:', {
			loanId: updatedLoan._id,
			amount: updatedLoan.amount,
			remainingAmount: updatedLoan.remainingAmount,
			totalPaid: updatedLoan.totalPaid,
			status: updatedLoan.status
		});
		
		return res.json(updatedLoan);
	} catch (err) {
		console.error('Error initializing payment tracking:', err);
		return res.status(500).json({ error: err?.message || "Failed to initialize payment tracking" });
	}
});

// Test endpoint
router.get("/test", (req, res) => {
	res.json({ message: "Manager routes working" });
});

// Get team performance data
router.get("/team-performance", async (req, res) => {
	try {
		console.log('Fetching team performance data...');
		
		// Get all agents
		const agents = await Agent.find({});
		console.log('Found agents:', agents.length);
		
		const teamPerformance = [];
		
		for (const agent of agents) {
			// Get loans assigned to this agent
			const loans = await Loan.find({ assignedAgent: agent.agentId });
			console.log(`Agent ${agent.agentId} has ${loans.length} loans`);
			
			// Calculate total disbursed amount
			const totalDisbursed = loans.reduce((sum, loan) => sum + (loan.amount || 0), 0);
			
			// Get payments made by this agent (non-reversed)
			const payments = await Payment.aggregate([
				{ $match: { agentId: agent.agentId, reversed: { $ne: true } } },
				{ $group: { _id: null, total: { $sum: "$amount" } } }
			]);
			
			const totalCollected = payments[0]?.total || 0;
			
			// Calculate success rate (collected vs disbursed)
			const successRate = totalDisbursed > 0 ? Math.round((totalCollected / totalDisbursed) * 100) : 0;
			
			// Set target (you can customize this logic)
			const target = Math.max(totalDisbursed * 0.8, 100000); // 80% of disbursed or 1L minimum
			
			// Get unique borrowers count
			const uniqueBorrowers = new Set(loans.map(loan => loan.borrowerId.toString())).size;
			
			teamPerformance.push({
				id: agent._id,
				name: agent.name,
				agentId: agent.agentId,
				collected: totalCollected,
				target: target,
				borrowers: uniqueBorrowers,
				successRate: Math.min(successRate, 100), // Cap at 100%
				status: agent.status || "active",
				totalDisbursed: totalDisbursed
			});
		}
		
		console.log('Team performance data:', teamPerformance);
		
		return res.json(teamPerformance);
	} catch (err) {
		console.error('Error fetching team performance:', err);
		return res.status(500).json({ error: err?.message || "Failed to fetch team performance" });
	}
});

// Get overdue cases
router.get("/overdue-cases", async (req, res) => {
	try {
		console.log('Fetching overdue cases...');
		
		// Get all active loans
		const loans = await Loan.find({ status: "active" })
			.populate('borrowerId', 'name firstName lastName phone')
			.populate('assignedAgent', 'name agentId');
		
		console.log('Found active loans:', loans.length);
		
		const overdueCases = [];
		const currentDate = new Date();
		
		for (const loan of loans) {
			// Calculate days past due
			const dueDate = new Date(loan.dueDate);
			const daysPastDue = Math.floor((currentDate - dueDate) / (1000 * 60 * 60 * 24));
			
			// Only include if overdue
			if (daysPastDue > 0) {
				// Get last payment date
				const lastPayment = await Payment.findOne({ 
					loanId: loan._id, 
					reversed: { $ne: true } 
				}).sort({ createdAt: -1 });
				
				const lastContact = lastPayment ? 
					Math.floor((currentDate - new Date(lastPayment.createdAt)) / (1000 * 60 * 60 * 24)) + ' days ago' :
					'No recent contact';
				
				overdueCases.push({
					borrower: loan.borrowerId?.name || `${loan.borrowerId?.firstName || ''} ${loan.borrowerId?.lastName || ''}`.trim(),
					agent: loan.assignedAgent?.name || 'Unknown Agent',
					agentId: loan.assignedAgent?.agentId || 'Unknown',
					amount: loan.remainingAmount || loan.amount || 0,
					daysPastDue: daysPastDue,
					lastContact: lastContact,
					loanId: loan._id,
					borrowerPhone: loan.borrowerId?.phone || 'N/A'
				});
			}
		}
		
		// Sort by days past due (highest first)
		overdueCases.sort((a, b) => b.daysPastDue - a.daysPastDue);
		
		console.log('Overdue cases found:', overdueCases.length);
		
		return res.json(overdueCases);
	} catch (err) {
		console.error('Error fetching overdue cases:', err);
		return res.status(500).json({ error: err?.message || "Failed to fetch overdue cases" });
	}
});

// Get collection records for all agents
router.get("/collection-records", async (req, res) => {
	try {
		console.log('Fetching collection records for all agents...');
		console.log('Query params:', req.query);
		console.log('Start date:', req.query.startDate);
		console.log('End date:', req.query.endDate);
		console.log('Agent ID:', req.query.agentId);
		
		// Get date filters from query parameters
		const { startDate, endDate, agentId } = req.query;
		
		// Build date filter
		let dateFilter = {};
		if (startDate || endDate) {
			dateFilter.createdAt = {};
			if (startDate) {
				const start = new Date(startDate);
				start.setHours(0, 0, 0, 0);
				dateFilter.createdAt.$gte = start;
				console.log('Start date filter:', start);
			}
			if (endDate) {
				const end = new Date(endDate);
				end.setHours(23, 59, 59, 999);
				dateFilter.createdAt.$lte = end;
				console.log('End date filter:', end);
			}
		}
		console.log('Final date filter:', dateFilter);
		
		// Get all agents (or specific agent if filtered)
		let agents;
		if (agentId) {
			agents = await Agent.find({ agentId });
		} else {
			agents = await Agent.find({});
		}
		console.log('Found agents:', agents.length);
		
		const collectionRecords = [];
		
		for (const agent of agents) {
			// Build payment filter
			const paymentFilter = {
				agentId: agent.agentId,
				reversed: { $ne: true },
				...dateFilter
			};
			
			// Get payments made by this agent (non-reversed) with date filter
			console.log(`Payment filter for agent ${agent.agentId}:`, paymentFilter);
			const payments = await Payment.find(paymentFilter).sort({ createdAt: -1 });
			console.log(`Found ${payments.length} payments for agent ${agent.agentId}`);
			
			// Get recent payments (last 10)
			const recentPayments = payments.slice(0, 10);
			
			// Calculate total collections for the filtered period
			const totalCollections = payments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
			
			// Get today's collections (always relative to today, not filtered date)
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const tomorrow = new Date(today);
			tomorrow.setDate(today.getDate() + 1);
			
			const todayPayments = await Payment.find({
				agentId: agent.agentId,
				reversed: { $ne: true },
				createdAt: { $gte: today, $lt: tomorrow }
			});
			
			const todayCollections = todayPayments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
			
			// Get this month's collections (always relative to current month)
			const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
			const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
			
			const monthPayments = await Payment.find({
				agentId: agent.agentId,
				reversed: { $ne: true },
				createdAt: { $gte: monthStart, $lt: monthEnd }
			});
			
			const monthCollections = monthPayments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
			
			// Get borrowers assigned to this agent
			const assignedLoans = await Loan.find({ assignedAgent: agent.agentId })
				.populate('borrowerId', 'name firstName lastName phone');
			
			const uniqueBorrowers = new Set(assignedLoans.map(loan => loan.borrowerId._id.toString())).size;
			
			collectionRecords.push({
				agentId: agent.agentId,
				agentName: agent.name,
				status: agent.status || 'active',
				totalCollections: totalCollections,
				todayCollections: todayCollections,
				monthCollections: monthCollections,
				totalPayments: payments.length,
				todayPayments: todayPayments.length,
				monthPayments: monthPayments.length,
				assignedBorrowers: uniqueBorrowers,
				recentPayments: recentPayments.map(payment => ({
					id: payment._id,
					amount: payment.amount,
					paymentMode: payment.paymentMode,
					createdAt: payment.createdAt,
					borrowerId: payment.borrowerId,
					location: payment.location,
					receiptName: payment.receiptName
				})),
				// Add filter info for display
				filterInfo: {
					startDate: startDate || null,
					endDate: endDate || null,
					agentId: agentId || null
				}
			});
		}
		
		// Sort by total collections (highest first)
		collectionRecords.sort((a, b) => b.totalCollections - a.totalCollections);
		
		console.log('Collection records prepared for', collectionRecords.length, 'agents');
		
		return res.json(collectionRecords);
	} catch (err) {
		console.error('Error fetching collection records:', err);
		return res.status(500).json({ error: err?.message || "Failed to fetch collection records" });
	}
});

// Owner-wide trends (collections sum, loans created, borrowers onboarded) for last N days
router.get("/owner/trends", async (req, res) => {
    try {
        const days = Math.max(parseInt(req.query.days) || 7, 1);
        const now = new Date();
        now.setHours(0,0,0,0);
        const start = new Date(now);
        start.setDate(now.getDate() - (days - 1));

        // Payments (exclude reversed)
        const paymentsAgg = await Payment.aggregate([
            { $match: { createdAt: { $gte: start }, reversed: { $ne: true } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, total: { $sum: "$amount" } } },
        ]);
        const paymentsByDay = new Map(paymentsAgg.map(p => [p._id, p.total]));

        // Loans created per day
        const loansAgg = await Loan.aggregate([
            { $match: { createdAt: { $gte: start } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        ]);
        const loansByDay = new Map(loansAgg.map(l => [l._id, l.count]));

        // Borrowers onboarded per day
        const borrowersAgg = await Borrower.aggregate([
            { $match: { createdAt: { $gte: start } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        ]);
        const borrowersByDay = new Map(borrowersAgg.map(b => [b._id, b.count]));

        const result = [];
        for (let i = 0; i < days; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const key = d.toISOString().slice(0,10);
            result.push({
                date: key,
                collections: paymentsByDay.get(key) || 0,
                loans: loansByDay.get(key) || 0,
                borrowers: borrowersByDay.get(key) || 0,
            });
        }

        return res.json(result);
    } catch (err) {
        console.error('Owner trends error:', err);
        return res.status(500).json({ error: err?.message || "Failed to fetch owner trends" });
    }
});

// Global payments list for owner (optional date filters)
router.get("/payments", async (req, res) => {
    try {
        const { startDate, endDate, includeReversed } = req.query;
        const filter = {};
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) {
                const s = new Date(startDate);
                s.setHours(0,0,0,0);
                filter.createdAt.$gte = s;
            }
            if (endDate) {
                const e = new Date(endDate);
                e.setHours(23,59,59,999);
                filter.createdAt.$lte = e;
            }
        }
        if (includeReversed !== 'true') {
            filter.reversed = { $ne: true };
        }
        const payments = await Payment.find(filter).sort({ createdAt: -1 });
        return res.json(payments);
    } catch (err) {
        return res.status(500).json({ error: err?.message || "Failed to fetch payments" });
    }
});
// Get pending borrower approvals
router.get("/borrower-approvals", async (req, res) => {
	try {
		console.log('Fetching pending borrower approvals...');
		
		// Get all borrowers with pending approval status
		const pendingBorrowers = await Borrower.find({ approvalStatus: "pending" })
			.sort({ createdAt: -1 });
		
		// Get associated loans for these borrowers
		const borrowerIds = pendingBorrowers.map(b => b._id);
		const loans = await Loan.find({ borrowerId: { $in: borrowerIds } });
		
		// Create a map of borrower to loan
		const borrowerToLoan = new Map();
		loans.forEach(loan => {
			borrowerToLoan.set(loan.borrowerId.toString(), loan);
		});
		
		// Combine borrower and loan data
		const borrowersWithLoans = pendingBorrowers.map(borrower => {
			const loan = borrowerToLoan.get(borrower._id.toString());
			return {
				...borrower.toObject(),
				loan: loan || null
			};
		});
		
		console.log(`Found ${borrowersWithLoans.length} pending borrower approvals`);
		return res.json(borrowersWithLoans);
	} catch (err) {
		console.error('Error fetching borrower approvals:', err);
		return res.status(500).json({ error: err?.message || "Failed to fetch borrower approvals" });
	}
});

// Approve borrower
router.post("/borrower-approvals/:borrowerId/approve", async (req, res) => {
	try {
		const { borrowerId } = req.params;
		const { approvedBy = "manager" } = req.body;
		
		console.log('Approving borrower:', borrowerId);
		
		const borrower = await Borrower.findById(borrowerId);
		if (!borrower) {
			return res.status(404).json({ error: "Borrower not found" });
		}
		
		if (borrower.approvalStatus !== "pending") {
			return res.status(400).json({ error: `Borrower is already ${borrower.approvalStatus}` });
		}
		
		// Update borrower approval status
		await Borrower.findByIdAndUpdate(borrowerId, {
			approvalStatus: "approved",
			approvedBy,
			approvedAt: new Date()
		});
		
		// Also update associated loan status if it exists
		await Loan.updateMany(
			{ borrowerId: borrowerId },
			{ status: "active" }
		);
		
		console.log('Borrower approved successfully:', borrowerId);
		return res.json({ 
			message: "Borrower approved successfully",
			borrowerId,
			approvedBy,
			approvedAt: new Date()
		});
	} catch (err) {
		console.error('Error approving borrower:', err);
		return res.status(500).json({ error: err?.message || "Failed to approve borrower" });
	}
});

// Reject borrower
router.post("/borrower-approvals/:borrowerId/reject", async (req, res) => {
	try {
		const { borrowerId } = req.params;
		const { rejectedBy = "manager", rejectionReason } = req.body;
		
		console.log('Rejecting borrower:', borrowerId, 'Reason:', rejectionReason);
		
		const borrower = await Borrower.findById(borrowerId);
		if (!borrower) {
			return res.status(404).json({ error: "Borrower not found" });
		}
		
		if (borrower.approvalStatus !== "pending") {
			return res.status(400).json({ error: `Borrower is already ${borrower.approvalStatus}` });
		}
		
		// Update borrower approval status
		await Borrower.findByIdAndUpdate(borrowerId, {
			approvalStatus: "rejected",
			rejectedBy,
			rejectedAt: new Date(),
			rejectionReason: rejectionReason || "Rejected by manager"
		});
		
		// Also update associated loan status if it exists
		await Loan.updateMany(
			{ borrowerId: borrowerId },
			{ status: "rejected" }
		);
		
		console.log('Borrower rejected successfully:', borrowerId);
		return res.json({ 
			message: "Borrower rejected successfully",
			borrowerId,
			rejectedBy,
			rejectedAt: new Date(),
			rejectionReason: rejectionReason || "Rejected by manager"
		});
	} catch (err) {
		console.error('Error rejecting borrower:', err);
		return res.status(500).json({ error: err?.message || "Failed to reject borrower" });
	}
});

// Get pending agent requests
router.get("/agent-requests", async (req, res) => {
	try {
		console.log('Fetching agent requests...');
		
		// Get all pending requests from localStorage (in a real app, this would be in database)
		// For now, we'll return a mock structure that matches what the frontend expects
		const requests = [
			// This would typically come from a database
		];
		
		return res.json(requests);
	} catch (err) {
		console.error('Error fetching agent requests:', err);
		return res.status(500).json({ error: err?.message || "Failed to fetch agent requests" });
	}
});

// Approve agent request
router.post("/agent-requests/:requestId/approve", async (req, res) => {
	try {
		const { requestId } = req.params;
		const { requestType, paymentId, agentId, amount, reason } = req.body;
		
		console.log('Approving agent request:', { requestId, requestType, paymentId, agentId, amount, reason });
		
		if (requestType === "reversal" && paymentId) {
			// Handle payment reversal
			const payment = await Payment.findById(paymentId);
			if (!payment) {
				console.log('Payment not found for ID:', paymentId);
				// For test purposes, we'll still return success but log the issue
				return res.json({ 
					message: "Payment reversal approved (test mode - payment not found in database)",
					paymentId,
					amount: 0,
					warning: "This was a test request - no actual payment was reversed"
				});
			}
			
			if (payment.reversed) {
				return res.status(400).json({ error: "Payment already reversed" });
			}
			
			// Mark payment as reversed
			await Payment.findByIdAndUpdate(paymentId, {
				reversed: true,
				reversedAt: new Date(),
				reversedBy: "manager",
				reversalReason: reason || "Approved by manager"
			});
			
			// Recalculate loan amounts
			const loan = await Loan.findById(payment.loanId);
			if (loan) {
				// Recalculate totalPaid and remainingAmount
				const totalPayments = await Payment.aggregate([
					{ $match: { loanId: loan._id, reversed: { $ne: true } } },
					{ $group: { _id: null, total: { $sum: "$amount" } } }
				]);
				
				const totalPaid = totalPayments[0]?.total || 0;
				const remainingAmount = Math.max(loan.amount - totalPaid, 0);
				const newStatus = remainingAmount <= 0 ? "paid" : "active";
				
				await Loan.findByIdAndUpdate(loan._id, {
					totalPaid,
					remainingAmount,
					status: newStatus
				});
			}
			
			return res.json({ 
				message: "Payment reversal approved successfully",
				paymentId,
				amount: payment.amount
			});
		} else if (requestType === "edit" && paymentId) {
			// Handle payment edit
			const { newAmount, newPaymentMode, newLocation, newReceiptName } = req.body;
			
			const updateData = {};
			if (newAmount !== undefined) updateData.amount = newAmount;
			if (newPaymentMode) updateData.paymentMode = newPaymentMode;
			if (newLocation) updateData.location = newLocation;
			if (newReceiptName) updateData.receiptName = newReceiptName;
			
			const updatedPayment = await Payment.findByIdAndUpdate(
				paymentId, 
				updateData, 
				{ new: true }
			);
			
			if (!updatedPayment) {
				console.log('Payment not found for edit ID:', paymentId);
				// For test purposes, we'll still return success but log the issue
				return res.json({ 
					message: "Payment edit approved (test mode - payment not found in database)",
					paymentId,
					updatedPayment: null,
					warning: "This was a test request - no actual payment was edited"
				});
			}
			
			// Recalculate loan amounts if amount changed
			if (newAmount !== undefined) {
				const loan = await Loan.findById(updatedPayment.loanId);
				if (loan) {
					const totalPayments = await Payment.aggregate([
						{ $match: { loanId: loan._id, reversed: { $ne: true } } },
						{ $group: { _id: null, total: { $sum: "$amount" } } }
					]);
					
					const totalPaid = totalPayments[0]?.total || 0;
					const remainingAmount = Math.max(loan.amount - totalPaid, 0);
					const newStatus = remainingAmount <= 0 ? "paid" : "active";
					
					await Loan.findByIdAndUpdate(loan._id, {
						totalPaid,
						remainingAmount,
						status: newStatus
					});
				}
			}
			
			return res.json({ 
				message: "Payment edit approved successfully",
				paymentId,
				updatedPayment
			});
		}
		
		return res.status(400).json({ error: "Invalid request type" });
	} catch (err) {
		console.error('Error approving agent request:', err);
		return res.status(500).json({ error: err?.message || "Failed to approve request" });
	}
});

// Reject agent request
router.post("/agent-requests/:requestId/reject", async (req, res) => {
	try {
		const { requestId } = req.params;
		const { reason } = req.body;
		
		console.log('Rejecting agent request:', { requestId, reason });
		
		// In a real app, you would update the request status in the database
		// For now, we'll just return success
		
		return res.json({ 
			message: "Request rejected successfully",
			requestId,
			reason: reason || "Rejected by manager"
		});
	} catch (err) {
		console.error('Error rejecting agent request:', err);
		return res.status(500).json({ error: err?.message || "Failed to reject request" });
	}
});

// Set loan as fully paid (for testing)
router.post("/loans/:loanId/set-paid", async (req, res) => {
	try {
		const { loanId } = req.params;
		
		const loan = await Loan.findById(loanId);
		if (!loan) {
			return res.status(404).json({ error: "Loan not found" });
		}
		
		// Set the loan as fully paid
		const updatedLoan = await Loan.findByIdAndUpdate(
			loanId,
			{
				$set: {
					totalPaid: loan.amount,
					remainingAmount: 0,
					status: "paid"
				}
			},
			{ new: true }
		);
		
		console.log('Loan set as fully paid:', {
			loanId: updatedLoan._id,
			amount: updatedLoan.amount,
			totalPaid: updatedLoan.totalPaid,
			remainingAmount: updatedLoan.remainingAmount,
			status: updatedLoan.status
		});
		
		return res.json(updatedLoan);
	} catch (err) {
		console.error('Set paid error:', err);
		return res.status(500).json({ error: err?.message || "Failed to set loan as paid" });
	}
});

// Fix all loans for an agent
router.post("/agent/:agentId/fix-loans", async (req, res) => {
	try {
		const { agentId } = req.params;
		
		console.log('Fix loans endpoint called for agent:', agentId);
		
		const loans = await Loan.find({ assignedAgent: agentId });
		console.log('Found loans:', loans.length);
		
		const results = [];
		
		for (const loan of loans) {
			// Calculate total payments for this loan (excluding reversed)
			const totalPayments = await Payment.aggregate([
				{ $match: { loanId: loan._id, reversed: { $ne: true } } },
				{ $group: { _id: null, total: { $sum: "$amount" } } }
			]);
			
			const totalPaid = Math.min(totalPayments[0]?.total || 0, loan.amount);
			const remainingAmount = Math.max(loan.amount - totalPaid, 0);
			
			const updatedLoan = await Loan.findByIdAndUpdate(loan._id, {
				remainingAmount,
				totalPaid,
				status: remainingAmount <= 0 ? "paid" : loan.status
			}, { new: true });
			
			results.push({
				loanId: updatedLoan._id,
				amount: updatedLoan.amount,
				remainingAmount: updatedLoan.remainingAmount,
				totalPaid: updatedLoan.totalPaid,
				status: updatedLoan.status
			});
		}
		
		console.log(`Fixed ${results.length} loans for agent ${agentId}:`, results);
		
		return res.json({ 
			message: `Fixed ${results.length} loans`,
			loans: results 
		});
	} catch (err) {
		console.error('Error fixing loans:', err);
		return res.status(500).json({ error: err?.message || "Failed to fix loans" });
	}
});

// Approve reversal request
router.post("/payments/:paymentId/reverse", async (req, res) => {
	try {
		const { paymentId } = req.params;
		
		console.log('Processing reversal for payment:', paymentId);
		
		// Find the payment
		const payment = await Payment.findById(paymentId);
		if (!payment) {
			return res.status(404).json({ error: "Payment not found" });
		}
		
		// Check if already reversed
		if (payment.reversed) {
			return res.status(400).json({ error: "Payment already reversed" });
		}
		
		// Mark payment as reversed
		const reversedPayment = await Payment.findByIdAndUpdate(
			paymentId,
			{ 
				reversed: true,
				reversedAt: new Date(),
				reversedBy: "manager" // In real app, get from auth context
			},
			{ new: true }
		);
		
		console.log('Payment marked as reversed:', reversedPayment._id);
		
		// Find the associated loan
		const loan = await Loan.findById(payment.loanId);
		if (!loan) {
			console.log('Warning: Loan not found for payment:', payment.loanId);
			return res.json({ 
				message: "Payment reversed successfully",
				payment: reversedPayment,
				warning: "Loan not found - please fix loans manually"
			});
		}
		
		// Recalculate loan amounts after reversal
		const totalPayments = await Payment.aggregate([
			{ $match: { loanId: loan._id, reversed: { $ne: true } } }, // Exclude reversed payments
			{ $group: { _id: null, total: { $sum: "$amount" } } }
		]);
		
		const totalPaid = totalPayments[0]?.total || 0;
		const remainingAmount = Math.max(loan.amount - totalPaid, 0);
		const newStatus = remainingAmount <= 0 ? "paid" : "active";
		
		// Update the loan
		const updatedLoan = await Loan.findByIdAndUpdate(
			loan._id,
			{
				totalPaid,
				remainingAmount,
				status: newStatus
			},
			{ new: true }
		);
		
		console.log('Loan updated after reversal:', {
			loanId: updatedLoan._id,
			amount: updatedLoan.amount,
			remainingAmount: updatedLoan.remainingAmount,
			totalPaid: updatedLoan.totalPaid,
			status: updatedLoan.status
		});
		
		return res.json({ 
			message: "Payment reversed successfully",
			payment: reversedPayment,
			loan: updatedLoan
		});
	} catch (err) {
		console.error('Error reversing payment:', err);
		return res.status(500).json({ error: err?.message || "Failed to reverse payment" });
	}
});

module.exports = router;


