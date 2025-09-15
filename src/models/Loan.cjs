const mongoose = require("mongoose");

const loanSchema = new mongoose.Schema(
	{
		borrowerId: { type: mongoose.Schema.Types.ObjectId, ref: "Borrower", required: true },
		amount: { type: Number, required: true },
		remainingAmount: { type: Number, required: true }, // Amount still owed
		totalPaid: { type: Number, default: 0 }, // Total amount paid so far
		interestRatePercent: { type: Number },
		tenureMonths: { type: Number },
		frequency: { type: String, enum: ["daily", "weekly", "monthly"], default: "monthly" },
		purpose: { type: String },
		assignedAgent: { type: String },
		status: { type: String, enum: ["pending", "active", "approved", "rejected", "closed", "cancelled", "paid"], default: "pending" },
		createdAt: { type: Date, default: Date.now },
		manager_comment: { type: String },
	},
	{ collection: "loans" }
);

module.exports = mongoose.model("Loan", loanSchema);

