const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

const managerRouter = require("./routes/manager");
const { connectToDatabase } = require("./lib/mongo.cjs");

dotenv.config();

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 5000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
	res.json({ status: "ok" });
});

app.use("/api/manager", managerRouter);

connectToDatabase()
	.then(() => {
		app.listen(port, () => {
			console.log(`Server running on http://localhost:${port}`);
		});
	})
	.catch((err) => {
		console.error("Failed to connect to MongoDB:", err?.message || err);
		process.exit(1);
	});


