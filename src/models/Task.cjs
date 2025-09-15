const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema(
	{
		title: { type: String, required: true },
		description: { type: String },
		agentId: { type: String, required: true },
		assignedBy: { type: String, required: true }, // Manager who assigned the task
		dueDate: { type: Date, required: true },
		priority: { 
			type: String, 
			enum: ["low", "medium", "high", "urgent"], 
			default: "medium" 
		},
		status: { 
			type: String, 
			enum: ["pending", "in_progress", "completed", "cancelled"], 
			default: "pending" 
		},
		completedAt: { type: Date },
		notes: { type: String },
		createdAt: { type: Date, default: Date.now },
	},
	{ collection: "tasks" }
);

module.exports = mongoose.model("Task", taskSchema);

