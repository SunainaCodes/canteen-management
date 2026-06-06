const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const mockDb = require('./mock-database');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Create HTTP Server for Socket.io integration
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Default database handle to local Mock DB (fail-safe fallback)
let db = mockDb;

// MySQL Connection Configuration (As per report specifications)
const realDbConnection = mysql.createConnection({
    host: 'localhost',
    user: 'root',      // Standard XAMPP user
    password: '',      // Standard XAMPP password
    database: 'cloud_canteen'
});

realDbConnection.connect((err) => {
    if (err) {
        console.warn('\x1b[33m%s\x1b[0m', '⚠️ MySQL Connection failed (or server not started). Using persistent JSON Mock Database fallback.');
    } else {
        console.log('\x1b[32m%s\x1b[0m', '✓ Connected to MySQL Database: cloud_canteen');
        db = realDbConnection;
    }
});

// Socket.io Real-time Event Handlers
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Listen for new orders placed by customers
    socket.on('new_order', (orderData) => {
        console.log('New order received:', orderData);
        
        // Save the new order to the database (MySQL or persistent mock fallback)
        const numericId = typeof orderData.id === 'string' ? orderData.id.replace(/\D/g, '') : orderData.id;
        const total = orderData.total || 0;
        
        // Default to user_id = 2 (John Doe) if not specified
        const sql = "INSERT INTO orders (id, user_id, total_amount, status) VALUES (?, ?, ?, ?)";
        db.query(sql, [numericId, 2, total, 'Pending'], (err, result) => {
            if (err) {
                console.error('Error saving order to MySQL/Mock DB:', err.message);
            } else {
                console.log(`Database updated: Saved Order #${numericId} (Total: ₹${total})`);
            }
        });

        // Broadcast new order to all clients (particularly the Admin/Kitchen dashboard)
        io.emit('new_order_received', orderData);
    });

    // Listen for order status updates from Admin/Kitchen
    socket.on('update_order_status', ({ orderId, status }) => {
        console.log(`Order ${orderId} updated to status: ${status}`);
        
        // Broadcast to all clients (updating the customer's tracker)
        io.emit('order_status_updated', { orderId, status });
        
        // Also update MySQL database if connected
        const numericId = typeof orderId === 'string' ? orderId.replace(/\D/g, '') : orderId;
        const sql = "UPDATE orders SET status = ? WHERE id = ?";
        
        db.query(sql, [status, numericId], (err, result) => {
            if (err) {
                console.error('Error updating order status in MySQL:', err.message);
            } else {
                console.log(`MySQL Database updated: Order #${numericId} status set to ${status}`);
            }
        });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

// API Route for User Registration
app.post('/api/register', (req, res) => {
    const { username, email, mobile, password } = req.body;
    const sql = "INSERT INTO users (username, email, mobile, password) VALUES (?, ?, ?, ?)";
    
    db.query(sql, [username, email, mobile, password], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "User registered successfully!", id: result.insertId });
    });
});

// API Route for Login
app.post('/api/login', (req, res) => {
    const { identifier, password } = req.body;
    const sql = "SELECT * FROM users WHERE (email = ? OR mobile = ?) AND password = ?";
    
    db.query(sql, [identifier, identifier, password], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) {
            res.json({ message: "Login successful!", user: results[0] });
        } else {
            res.status(401).json({ message: "Invalid credentials" });
        }
    });
});

// Real-time Update Route (Logic for Socket.io integration)
app.post('/api/update-status', (req, res) => {
    const { orderId, status } = req.body;
    const sql = "UPDATE orders SET status = ? WHERE id = ?";
    
    const numericId = typeof orderId === 'string' ? orderId.replace(/\D/g, '') : orderId;
    
    db.query(sql, [status, numericId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Emit Socket.io event for real-time tracking
        io.emit('order_status_updated', { orderId: `#CC-${numericId}`, status });
        
        res.json({ message: "Order status updated!" });
    });
});

const PORT = 5000;
server.listen(PORT, () => {
    console.log(`Backend Server running with Socket.io on http://localhost:${PORT}`);
    
    // Automatically open in default browser
    const url = `http://localhost:${PORT}`;
    let command;
    if (process.platform === 'win32') {
        command = `start "" "${url}"`;
    } else if (process.platform === 'darwin') {
        command = `open "${url}"`;
    } else {
        command = `xdg-open "${url}"`;
    }
    
    require('child_process').exec(command, (err) => {
        if (err) {
            console.error('Failed to open browser automatically:', err.message);
        }
    });
});
