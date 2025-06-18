const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const multer = require("multer");
const { Pool } = require("pg");
const path = require("path");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Middleware
app.use(express.json());
app.use(cors({
  origin: "*",
  methods: "GET, POST, PUT",
  allowedHeaders: "Content-Type",
  credentials: true
}));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ✅ PostgreSQL Database Connection
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "e-wastemanagement",
  password: "mini",
  port: 5432
});

pool.connect()
    .then(() => console.log("✅ Connected to PostgreSQL successfully!"))
    .catch(err => console.error("❌ Database connection failed:", err));

// ✅ Multer Setup for Image Uploads
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// ✅ Configure Email Transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_PASSWORD
  }
});

// ✅ Function to Send Email
const sendEmail = async (to, subject, text) => {
  try {
    await transporter.sendMail({ from: process.env.EMAIL, to, subject, text });
    console.log(`📩 Email sent to ${to}`);
  } catch (error) {
    console.error("❌ Email sending error:", error);
  }
};

// ✅ Register User Route
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: "All fields are required" });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            "INSERT INTO users (name, email, password) VALUES ($1, $2, $3)",
            [name, email, hashedPassword]
        );
        res.json({ message: "User registered successfully" });
    } catch (error) {
        console.error("❌ Database error:", error);
        res.status(500).json({ error: "Database error (email may already exist)" });
    }
});

// ✅ Login User Route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "All fields are required" });
    }
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        const user = result.rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        res.json({ message: "Login successful", user: { id: user.id, name: user.name, email: user.email } });
    } catch (error) {
        console.error("❌ Database error:", error);
        res.status(500).json({ error: "Database error" });
    }
});

// ✅ API to Upload Disposal Items
app.post("/api/dispose", upload.single("image"), async (req, res) => {
    try {
        const image_url = req.file ? `/uploads/${req.file.filename}` : null;
        const { item_name, description, contact } = req.body;
        if (!item_name || !description || !contact) {
            return res.status(400).json({ error: "All fields are required!" });
        }
        const result = await pool.query(
            "INSERT INTO disposal (image_url, item_name, description, contact) VALUES ($1, $2, $3, $4) RETURNING *",
            [image_url, item_name, description, contact]
        );
        res.status(201).json({ message: "E-waste uploaded successfully", data: result.rows[0] });
    } catch (error) {
        console.error("Error in /api/dispose:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ✅ API to Fetch Disposal Items
app.get("/api/disposals", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM disposal ORDER BY id DESC");
        res.json(result.rows);
    } catch (error) {
        console.error("Error in /api/disposals:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ✅ API to Fetch Requests (FIXED: Added this route)
app.get("/api/requests", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM requests ORDER BY id DESC");
        res.json(result.rows);
    } catch (error) {
        console.error("Error in /api/requests:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


// ✅ API for Receivers to Request a Part
app.post("/api/request", async (req, res) => {
    try {
        const { disposal_id, receiver_name, receiver_contact, receiver_email } = req.body;
        if (!disposal_id || !receiver_name || !receiver_contact || !receiver_email) {
            return res.status(400).json({ error: "All fields are required!" });
        }
        const result = await pool.query(
            "INSERT INTO requests (disposal_id, receiver_name, receiver_contact, receiver_email, status) VALUES ($1, $2, $3, $4, 'Pending') RETURNING *",
            [disposal_id, receiver_name, receiver_contact, receiver_email]
        );
        res.status(201).json({ message: "Request submitted successfully", data: result.rows[0] });
    } catch (error) {
        console.error("Error in /api/request:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
  
// ✅ API to Fetch Requests for a Specific Disposal Item
app.get("/api/requests/:disposal_id", async (req, res) => {
    try {
        const { disposal_id } = req.params;
        const result = await pool.query("SELECT * FROM requests WHERE disposal_id = $1 ORDER BY id DESC", [disposal_id]);
        res.json(result.rows);
    } catch (error) {
        console.error("Error in /api/requests/:disposal_id:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ✅ API to Approve or Reject Requests with Email Notification
app.put("/api/request/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status || !["Approved", "Rejected"].includes(status)) {
            return res.status(400).json({ error: "Invalid status!" });
        }

        const requestResult = await pool.query("SELECT * FROM requests WHERE id = $1", [id]);
        if (requestResult.rows.length === 0) {
            return res.status(404).json({ error: "Request not found!" });
        }

        const request = requestResult.rows[0];

        await pool.query("UPDATE requests SET status = $1 WHERE id = $2", [status, id]);

        // Notify the requester
        const emailSubject = `Your E-Waste Request has been ${status}`;
        const emailText = `Hello,\n\nYour request for the e-waste item (ID: ${request.disposal_id}) has been ${status}.\n\nThank you for using our system!\nE-Waste Management Team`;
        sendEmail(request.receiver_email, emailSubject, emailText);

        // Create a notification for the requester
        const message = `Your request for item ID ${request.disposal_id} has been ${status}.`;
        await pool.query(
            "INSERT INTO notifications (disposal_id, message) VALUES ($1, $2)",
            [request.disposal_id, message]
        );

        res.json({ message: `Request ${status} successfully!` });
    } catch (error) {
        console.error("Error in /api/request/:id:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ✅ API to Fetch Notifications for a Disposal Item
app.get("/api/notifications/:disposal_id", async (req, res) => {
    try {
        const { disposal_id } = req.params;
        const result = await pool.query("SELECT * FROM notifications WHERE disposal_id = $1 ORDER BY created_at DESC", [disposal_id]);
        res.json(result.rows);
    } catch (error) {
        console.error("Error in /api/notifications/:disposal_id:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ✅ Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
