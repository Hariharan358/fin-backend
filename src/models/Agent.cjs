const mongoose = require("mongoose");

const agentSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		agentId: { type: String, required: true, unique: true },
		phone: { type: String },
		email: { type: String },
		status: { type: String, enum: ["active", "on_leave", "inactive"], default: "active" },
		createdAt: { type: Date, default: Date.now },
	},
	{ collection: "agents" }
);

module.exports = mongoose.model("Agent", agentSchema);





