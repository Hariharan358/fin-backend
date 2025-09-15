const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
	{
		loanId: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", required: true },
		borrowerId: { type: mongoose.Schema.Types.ObjectId, ref: "Borrower", required: true },
		agentId: { type: String, required: true },
		amount: { type: Number, required: true },
		paymentMode: { type: String, enum: ["cash", "upi", "card", "cheque"], default: "cash" },
		location: {
			latitude: { type: Number },
			longitude: { type: Number }
		},
		receiptName: { type: String },
		reversed: { type: Boolean, default: false },
		reversedAt: { type: Date },
		reversedBy: { type: String },
		createdAt: { type: Date, default: Date.now },
	},
	{ collection: "payments" }
);

module.exports = mongoose.model("Payment", paymentSchema);



