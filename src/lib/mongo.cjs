const mongoose = require("mongoose");

async function connectToDatabase() {
	const mongoUri = process.env.MONGODB_URI;
	if (!mongoUri) {
		throw new Error("Missing MONGODB_URI in environment");
	}
	mongoose.set("strictQuery", true);
	const connection = mongoose.connection;
	connection.on("error", (err) => {
		console.error("MongoDB connection error:", err?.message || err);
	});
	connection.once("open", () => {
		console.log("MongoDB connected (event)");
	});

	await mongoose.connect(mongoUri, {
		// Options can be tuned here if needed
	});
	// In case the 'open' event fired before listeners, also log success here.
	console.log("MongoDB connected");
	return mongoose;
}

module.exports = { connectToDatabase };

