const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// Load environment variables early so any modules that read process.env during import can see them
dotenv.config();

// Optionally silence console.log output in production if requested
if (process.env.SILENCE_LOGS === "true") {
    // eslint-disable-next-line no-console
    console.log = () => {};
}

const managerRouter = require("./routes/manager");
const { connectToDatabase } = require("./lib/mongo.cjs");

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 5000;

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "finance-app-backend", routes: ["/health", "/api/manager/*"] });
});

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


