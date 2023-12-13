const { Router } = require('express');
const { Pool } = require('pg');

module.exports = function (clientConfig, connections) {

    const express = require('express');
    const { Client } = require('pg');
    const { v4: uuidv4 } = require('uuid');
    const router = express.Router();

    connections.forEach(item => {
        // Use Client to connect to each database
        const client = new Client(item.connection);
    
        client.connect(err => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(`Connected to database: ${item.connection.database}`);
        });

        // Execute an advanced query
        router.post(`/${item.clientToken}/query`, async (req, res) => {
            const query = req.body.query;
            console.log('Received request at /query');
            console.log('Query:', query);
            
            try {
                const result = await client.query(query);
                console.log('Result:', result.rows);
                res.status(200).json(result.rows);
            } catch (err) {
                console.error('Error:', err.message);
                res.status(500).json({ message: err.message });
            }
        })

        // Drop a table
        router.delete(`/${item.clientToken}/drop/:table`, async (req, res) => {
            const tableName = req.params.table;
            try {
            const queryText = `DROP TABLE ${tableName}`; // Insert table name directly
            await client.query(queryText);
        
            res.status(200).json({ message: `Table ${tableName} dropped` });
            } catch (err) {
            res.status(500).json({ message: err.message });
            }
        });

        router.get(`/${item.clientToken}/tables`, async (req, res) => {
            try {
            const queryText = `
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                ORDER BY table_name;
            `;
            const result = await client.query(queryText);
        
            res.status(200).json(result.rows);
            } catch (err) {
            res.status(500).json({ message: err.message });
            }
        });
    
        // Get all records from a table
        router.get(`/${item.clientToken}/:table`, async (req, res) => {
            console.log('Received request at /query');
            const tableName = req.params.table;
        
            try {
            const result = await client.query(`SELECT * FROM ${tableName}`);
            res.status(200).json(result.rows);
            } catch (err) {
            res.status(500).json({ message: err.message });
            }
        });
    
        // Get a single record by ID from a table
        router.get(`/${item.clientToken}/:table/:id`, async (req, res) => {
            const tableName = req.params.table;
            const recordId = req.params.id;
        
            try {
            const result = await client.query(`SELECT * FROM ${tableName} WHERE _id = $1`, [recordId]);
        
            if (result.rowCount === 0) {
                res.status(404).json({ message: 'Record not found' });
                return;
            }
        
            res.status(200).json(result.rows[0]);
            } catch (err) {
            res.status(500).json({ message: err.message });
            }
        });
    
        // Insert a record into a table, create the table and columns if they don't exist
        router.post('/:table', async (req, res) => {
            const tableName = req.params.table;
            const data = req.body.data;
        
            try {
            // Check if the table exists
            const checkTableQuery = `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1);`;
            const checkTableResult = await client.query(checkTableQuery, [tableName]);
        
            // If the table doesn't exist, create it with the primary key _id, UUID data type, and a createdAt timestamp
            if (!checkTableResult.rows[0].exists) {
                const createTableQuery = `CREATE TABLE ${tableName} (_id UUID PRIMARY KEY, createdAt TIMESTAMP);`;
                await client.query(createTableQuery);
            }
        
            // Add columns if they don't exist
            for (const [key, value] of Object.entries(data)) {
                const columnType = typeof value === 'number' ? 'numeric' : 'text';
                const addColumnQuery = `
                ALTER TABLE ${tableName}
                ADD COLUMN IF NOT EXISTS ${key} ${columnType};
                `; 
                await client.query(addColumnQuery);
            }
        
            const _id = uuidv4(); // Generate a new UUID
            const createdAt = new Date().toISOString(); // Generate a current timestamp
            const columns = ['_id', 'createdAt', ...Object.keys(data)].join(', ');
            const values = [_id, createdAt, ...Object.values(data)];
            const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        
            const insertQuery = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders}) RETURNING *`;
            const result = await client.query(insertQuery, values);
        
            res.status(201).json(result.rows[0]);
            } catch (err) {
            res.status(500).json({ message: err.message });
            }
        });
    
        // Update a record by ID in a table
        router.put('/:table/:id', async (req, res) => {
            const tableName = req.params.table;
            const recordId = req.params.id;
            const data = req.body.data; // Access the 'data' key here
        
            try {
            const setClause = Object.keys(data)
                .map((key, i) => `${key} = $${i + 1}`)
                .join(', ');
            const values = Object.values(data).concat(recordId);
            const updatedAt = new Date().toISOString(); // Generate a current timestamp
        
            // Add updatedAt column if it doesn't exist
            const addColumnQuery = `
                ALTER TABLE ${tableName}
                ADD COLUMN IF NOT EXISTS updatedAt TIMESTAMP;
            `;
            await client.query(addColumnQuery);
        
            const updateQuery = `UPDATE ${tableName} SET ${setClause}, updatedAt = '${updatedAt}' WHERE _id = $${values.length} RETURNING *`;
            const result = await client.query(updateQuery, values);
        
            if (result.rowCount === 0) {
                res.status(404).json({ message: 'Record not found' });
                return;
            }
        
            res.status(200).json(result.rows[0]);
            } catch (err) {
            res.status(500).json({ message: err.message });
            }
        });
    
        // Delete a record by ID from a table
        router.delete('/:table/:id', async (req, res) => {
        const tableName = req.params.table;
        const recordId = req.params.id;
        
        try {
            const queryText = `DELETE FROM ${tableName} WHERE _id = $1`; // Insert table name directly
            const values = [recordId];
            const result = await client.query(queryText, values);
        
            if (result.rowCount > 0) {
            res.status(200).json({ message: 'Record deleted' });
            } else {
            res.status(404).json({ message: 'Record not found' });
            }
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
        });
        
    });


  return router;
};