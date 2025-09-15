const mongoose = require("mongoose");

const borrowerSchema = new mongoose.Schema(
	{
		// Basic
		name: { type: String, required: true },
		firstName: { type: String },
		lastName: { type: String },
		email: { type: String },
		phone: { type: String },
		dateOfBirth: { type: Date },

		// Address
		address: { type: String },
		city: { type: String },
		state: { type: String },
		pincode: { type: String },

		// Assignment
		assignedAgent: { type: String },
		status: { type: String, enum: ["active", "inactive", "suspended"], default: "active" },
		approvalStatus: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
		approvedBy: { type: String },
		approvedAt: { type: Date },
		rejectedBy: { type: String },
		rejectedAt: { type: Date },
		rejectionReason: { type: String },

		createdAt: { type: Date, default: Date.now },
	},
	{ collection: "borrowers" }
);

module.exports = mongoose.model("Borrower", borrowerSchema);

