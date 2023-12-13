const { Router } = require('express');
const mysql = require('mysql2/promise');

module.exports = function (clientConfig,connections) {
    const express = require('express');
    const router = express.Router();

    // Create a connection pool for each client
    const pools = {};
    for (const connection of connections) {
        const connectionConfig = {
            ...connection.connection,
            multipleStatements: true,
        };
        pools[connection.clientToken] = mysql.createPool(connectionConfig);
    }
    
    // Define router endpoints for each client
    for (const item of connections) {
        const pool = pools[item.clientToken];

        console.log("connections",connections);

        // Execute an advanced query
        router.post(`/${item.clientToken}/:query`, async (req, res) => {
            const query = req.body.query;
            try {
            const [result] = await pool.query(query);
            console.log('Result:', result);
            res.setHeader('X-Test', 'MyClient/1.0.0');
            res.status(200).json(result);
            } catch (err) {
            console.error('Error:', err.message);
            res.status(500).json({ message: err.message });
            }
        });

        // Drop a table
        router.delete('/drop/:table', async (req, res) => {
            const tableName = req.params.table;
            try {
            const queryText = `DROP TABLE ${tableName}`; // Insert table name directly
            await pool.query(queryText);
            res.status(200).json({ message: `Table ${tableName} dropped` });
            } catch (err) {
            res.status(500).json({ message: err.message });
            }
        });

        router.get('/tables', async (req, res) => {
            try {
                const queryText = `
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = (SELECT DATABASE())
                    ORDER BY table_name;
                `;
                const [result] = await pool.query(queryText);
        
                res.status(200).json(result);
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });
        
        // Get all records from a table
        router.get('/:table', async (req, res) => {
            console.log('Received request at /query');
            const tableName = req.params.table;

            try {
            const [result] = await pool.query(`SELECT * FROM ${tableName}`);
            res.status(200).json(result);
            } catch (err) {
            res.status(500).json({ message: err.message });
            }
        });

        // Get a single record by ID from a table
        router.get('/:table/:id', async (req, res) => {
            const tableName = req.params.table;
            const recordId = req.params.id;

            try {
            const [result] = await pool.query(`SELECT * FROM ${tableName} WHERE _id = ?`, [recordId]);

            if (result.length === 0) {
                res.status(404).json({ message: 'Record not found' });
                return;
            }

            res.status(200).json(result[0]);
            } catch (err) {
            res.status(500).json({ message: err.message });
            }
        });

        // Insert a record into a table
        router.post('/:table', async (req, res) => {
            const tableName = req.params.table;
            const data = req.body.data;

            try {
                const createdAt = new Date().toISOString(); // Generate a current timestamp
                const columns = ['createdAt', ...Object.keys(data)].join(', ');
                const values = [createdAt, ...Object.values(data)];
                const placeholders = values.map((_, i) => `?`).join(', ');

                const insertQuery = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
                const [result] = await pool.query(insertQuery, values);
                
                const lastInsertId = result.insertId;

                res.status(201).json({ message: 'Record inserted', _id: lastInsertId, createdAt, ...data });

            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // Update a record by ID in a table
        router.put('/:table/:id', async (req, res) => {
            const tableName = req.params.table;
            const recordId = req.params.id;
            const data = req.body.data;

            try {
                const setClause = Object.keys(data)
                    .map((key, i) => `${key} = ?`)
                    .join(', ');
                const values = Object.values(data).concat(recordId);

                const updateQuery = `UPDATE ${tableName} SET ${setClause}, updatedAt = NOW() WHERE _id = ?`;
                const [result] = await pool.query(updateQuery, values);

                if (result.affectedRows === 0) {
                    res.status(404).json({ message: 'Record not found' });
                    return;
                }

                const updatedAtQuery = `SELECT updatedAt FROM ${tableName} WHERE _id = ?`;
                const [rows] = await pool.query(updatedAtQuery, [recordId]);
                const updatedAt = rows[0].updatedAt;

                res.status(200).json({ ...data, _id: recordId, updatedAt });
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // Delete a record by ID from a table
        router.delete('/:table/:id', async (req, res) => {
            const tableName = req.params.table;
            const recordId = req.params.id;

            try {
            const queryText = `DELETE FROM ${tableName} WHERE _id = ?`;
            const [result] = await pool.query(queryText, [recordId]);

            if (result.affectedRows === 0) {
                res.status(404).json({ message: 'Record not found' });
                return;
            }

            res.status(200).json({ message: `Record with ID ${recordId} deleted` });
            } catch (err) {
            res.status(500).json({ message: err.message });
            }
        });
    }

    return router;
};
