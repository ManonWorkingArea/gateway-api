const express = require('express');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // ปรับ path
const { ObjectId } = require('mongodb');

const router = express.Router();

// --- Locations Endpoints (Mounted under /inventorys/locations) ---

// GET /inventorys/locations - Retrieve all locations with total stock quantity
router.get('/locations', async (req, res) => {
    try {
        const db = req.client.db('dss'); // ใช้ DB name ของคุณ
        const locationsCollection = db.collection('locations');
        const inventoryCollection = db.collection('inventorys');
        const ownerFilter = req.headers.owner; // Get owner from header

        // --- Build the filter for locations ---
        const locationQuery = {};
        if (ownerFilter) {
            locationQuery.owner = ownerFilter; // Add owner filter if header exists
        }
        // If ownerFilter is null or undefined, locationQuery remains {}, fetching all

        // 1. Aggregate total quantity per location from 'inventorys'
        const stockPerLocation = await inventoryCollection.aggregate([
            {
                // Group by locationId and sum the quantity
                $group: {
                    _id: "$locationId", // Group key is the location ObjectId
                    totalStockQuantity: { $sum: "$quantity" } // Calculate sum
                }
            }
        ]).toArray();

        // 2. Create a Map for easy lookup: { locationIdString: totalQuantity }
        const stockMap = new Map();
        stockPerLocation.forEach(item => {
            if (item._id) { // Ensure _id is not null
                stockMap.set(item._id.toString(), item.totalStockQuantity);
            }
        });

        // 3. Fetch locations based on the constructed query
        const locations = await locationsCollection.find(locationQuery, { sort: { name: 1 } }).toArray();

        // 4. Combine location data with total stock quantity
        const locationsWithStock = locations.map(location => {
            const locationIdString = location._id.toString();
            const totalQuantity = stockMap.get(locationIdString) || 0; // Get sum from map or default to 0
            return {
                ...location, // Keep original location data
                totalStockQuantity: totalQuantity // Add the calculated sum
            };
        });

        // 5. Send the combined data
        res.status(200).json({ success: true, data: locationsWithStock });

    } catch (error) {
        console.error('Error fetching locations with stock totals:', error);
        res.status(500).json({ error: 'Failed to fetch locations' });
    }
});

// POST /inventorys/locations - Create a new location
router.post('/locations', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const locationsCollection = db.collection('locations');
        const { name } = req.body;
        const ownerFromHeader = req.headers.owner; // Get owner from header

        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Location name is required and must be a non-empty string.' });
        }
        const trimmedName = name.trim();

        const existingLocation = await locationsCollection.findOne({ name: trimmedName });
        if (existingLocation) {
             // Consider if uniqueness should be per owner? For now, it's global.
            return res.status(409).json({ error: `Location name "${trimmedName}" already exists.` });
        }

        const newLocation = {
            name: trimmedName,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Add owner if it exists in the header
        if (ownerFromHeader) {
            newLocation.owner = ownerFromHeader;
        }

        const result = await locationsCollection.insertOne(newLocation);
        const createdLocation = await locationsCollection.findOne({ _id: result.insertedId });

        // Add totalStockQuantity (which will be 0 for a new location)
        createdLocation.totalStockQuantity = 0;

        res.status(201).json({ success: true, data: createdLocation });
    } catch (error) {
        console.error('Error creating location:', error);
        res.status(500).json({ error: 'Failed to create location' });
    }
});

// DELETE /inventorys/locations/:locationId - Delete a location
router.delete('/locations/:locationId', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const locationsCollection = db.collection('locations');
        const inventoryCollection = db.collection('inventorys');
        const locationId = safeObjectId(req.params.locationId);

        if (!locationId) {
             return res.status(400).json({ error: 'Invalid Location ID format.' });
        }

        const inventoryInLocation = await inventoryCollection.findOne({ locationId: locationId });
        if (inventoryInLocation) {
            return res.status(400).json({ error: 'Location is in use (has inventory) and cannot be deleted.' });
        }

        const result = await locationsCollection.deleteOne({ _id: locationId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Location not found.' });
        }
        res.status(200).json({ success: true, message: "Location deleted successfully." });
    } catch (error) {
        console.error('Error deleting location:', error);
        res.status(500).json({ error: 'Failed to delete location' });
    }
});

// PATCH /inventorys/locations/:locationId - Update a location (partial update)
router.patch('/locations/:locationId', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const locationsCollection = db.collection('locations');
        const locationId = safeObjectId(req.params.locationId);

        if (!locationId) {
            return res.status(400).json({ error: 'Invalid Location ID format.' });
        }

        const updateData = req.body;

        // --- Basic Validation ---
        if (Object.keys(updateData).length === 0) {
             return res.status(400).json({ error: 'No update data provided.' });
        }

        // Prepare fields to update, disallow updating _id or createdAt
        const fieldsToUpdate = { ...updateData };
        delete fieldsToUpdate._id;
        delete fieldsToUpdate.createdAt;

        // Specific validation and uniqueness check if 'name' is being updated
        if (fieldsToUpdate.hasOwnProperty('name')) {
            const newName = fieldsToUpdate.name;
            if (!newName || typeof newName !== 'string' || newName.trim() === '') {
                 return res.status(400).json({ error: 'Location name cannot be empty.' });
            }
            fieldsToUpdate.name = newName.trim(); // Use trimmed name

            // Check if the new name already exists for *another* location
            const existingLocation = await locationsCollection.findOne({
                name: fieldsToUpdate.name,
                _id: { $ne: locationId } // Exclude the current location from the check
             });
            if (existingLocation) {
                return res.status(409).json({ error: `Location name "${fieldsToUpdate.name}" already exists.` });
            }
        }

        // Add updatedAt timestamp
        fieldsToUpdate.updatedAt = new Date();

        // --- Update using findOneAndUpdate to get the updated document ---
        const result = await locationsCollection.findOneAndUpdate(
            { _id: locationId }, // Filter by ID
            { $set: fieldsToUpdate }, // Apply the updates
            { returnDocument: 'after' } // Return the document *after* the update
        );

        // --- Not Found Check ---
        if (!result.value) { // findOneAndUpdate returns result in 'value' field
            return res.status(404).json({ error: 'Location not found.' });
        }

        // --- Optional: Add totalStockQuantity to the response ---
        const inventoryCollection = db.collection('inventorys');
        const stockSumResult = await inventoryCollection.aggregate([
             { $match: { locationId: locationId } },
             { $group: { _id: null, totalStockQuantity: { $sum: "$quantity" } } }
        ]).toArray();
        const totalStock = stockSumResult.length > 0 ? stockSumResult[0].totalStockQuantity : 0;
        const responseData = { ...result.value, totalStockQuantity: totalStock };


        // --- Response ---
        res.status(200).json({ success: true, data: responseData }); // Return the updated location with stock count

    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({ error: 'Failed to update location' });
    }
});

// --- Stock Management Endpoints (Mounted under /inventorys) ---

// POST /inventorys/stock/initialize - Initialize stock (Simplified)
router.post('/stock/initialize', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const inventoryCollection = db.collection('inventorys');
        const movementsCollection = db.collection('stock_movements');
        const productsCollection = db.collection('products');
        const locationsCollection = db.collection('locations');
        const ownerFromHeader = req.headers.owner; // Get owner from header

        const { productId, locationId, initialQuantity, notes } = req.body;
        const userId = req.user?._id; // Optional: Get user ID

        // --- Validation ---
        const productIdObj = safeObjectId(productId);
        const locationIdObj = safeObjectId(locationId);

        if (!productIdObj || !locationIdObj) {
            return res.status(400).json({ error: 'Valid productId and locationId are required.' });
        }
        if (initialQuantity == null || typeof initialQuantity !== 'number' || !Number.isInteger(initialQuantity) || initialQuantity < 0) {
            return res.status(400).json({ error: 'initialQuantity is required and must be a non-negative integer.' });
        }

        // Validate product and location existence BEFORE trying to insert
        const productExists = await productsCollection.findOne({ _id: productIdObj });
        if (!productExists) {
            return res.status(404).json({ error: `Product with ID ${productId} not found.` });
        }
        const locationExists = await locationsCollection.findOne({ _id: locationIdObj });
        if (!locationExists) {
            return res.status(404).json({ error: `Location with ID ${locationId} not found.` });
        }

        // --- Owner Check on Location ---
        if (ownerFromHeader && locationExists.owner !== ownerFromHeader) {
             return res.status(403).json({ error: `Permission denied: Location ${locationId} does not belong to the specified owner.` });
        }

        // Check for existing inventory record (within the same owner context if owner is provided)
        const inventoryQuery = { productId: productIdObj, locationId: locationIdObj };
        // No need to add owner to inventory query, as productId+locationId should be unique anyway.
        // However, the location check above ensures we are acting within the correct owner's scope.

        const existingInventory = await inventoryCollection.findOne(inventoryQuery);
        if (existingInventory) {
            return res.status(409).json({ error: "Inventory for this product/location already initialized." });
        }

        // --- Perform Operations Sequentially ---
        // 1. Create Inventory Record
        const newInventory = {
            productId: productIdObj,
            locationId: locationIdObj,
            quantity: initialQuantity,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        // Add owner if present
        if (ownerFromHeader) {
            newInventory.owner = ownerFromHeader;
        }
        const inventoryResult = await inventoryCollection.insertOne(newInventory);
        const createdInventoryId = inventoryResult.insertedId;

        // 2. Create Stock Movement Record (LOGGING)
        const newMovement = {
            productId: productIdObj,
            locationId: locationIdObj,
            inventoryId: createdInventoryId,
            type: 'INITIAL',
            quantityChange: initialQuantity,
            quantityAfter: initialQuantity,
            notes: notes || null,
            timestamp: new Date(),
            userId: userId || null
        };
         // Add owner if present
        if (ownerFromHeader) {
            newMovement.owner = ownerFromHeader;
        }
        const movementResult = await movementsCollection.insertOne(newMovement);
        const createdMovementId = movementResult.insertedId;

        // --- Response ---
        res.status(201).json({
            success: true,
            data: { inventoryId: createdInventoryId.toString(), movementId: createdMovementId.toString() }
        });

    } catch (error) {
        console.error('Error initializing inventory:', error);
        res.status(500).json({ error: 'Failed to initialize inventory' });
    }
});

// POST /inventorys/stock/adjust - Adjust stock quantity (Simplified)
router.post('/stock/adjust', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const inventoryCollection = db.collection('inventorys');
        const movementsCollection = db.collection('stock_movements');
        const ownerFromHeader = req.headers.owner; // Get owner from header

        const { inventoryId, newQuantity, reason, notes } = req.body;
        const userId = req.user?._id;

        // --- Validation ---
        const inventoryIdObj = safeObjectId(inventoryId);
        if (!inventoryIdObj) {
            return res.status(400).json({ error: 'Valid inventoryId is required.' });
        }
        if (newQuantity == null || typeof newQuantity !== 'number' || !Number.isInteger(newQuantity) || newQuantity < 0) {
            return res.status(400).json({ error: 'newQuantity is required and must be a non-negative integer.' });
        }
        if (!reason || typeof reason !== 'string' || reason.trim() === '') {
            return res.status(400).json({ error: 'Reason code is required.' });
        }

        // --- Perform Operations Sequentially ---
        // 1. Find Inventory Record
        const inventoryRecord = await inventoryCollection.findOne({ _id: inventoryIdObj });
        if (!inventoryRecord) {
            return res.status(404).json({ error: `Inventory record with ID ${inventoryId} not found.` });
        }

        // --- Owner Check ---
        // Check if the owner from the header matches the owner stored on the inventory record
        if (ownerFromHeader && inventoryRecord.owner !== ownerFromHeader) {
             // If inventoryRecord.owner is null/undefined OR doesn't match header
             return res.status(403).json({ error: 'Permission denied: Inventory record does not belong to the specified owner.' });
        }
        // Proceed if no owner filter or if owner matches

        const currentQuantity = inventoryRecord.quantity;
        const quantityChange = newQuantity - currentQuantity;

        // 2. Create Stock Movement Record (LOGGING)
        const newMovement = {
            productId: inventoryRecord.productId,
            locationId: inventoryRecord.locationId,
            inventoryId: inventoryIdObj,
            type: 'ADJUSTMENT',
            quantityChange: quantityChange,
            quantityAfter: newQuantity,
            reason: reason.trim(),
            notes: notes || null,
            timestamp: new Date(),
            userId: userId || null
        };
        // Add owner if present
        if (ownerFromHeader) {
            newMovement.owner = ownerFromHeader;
        }
        const movementResult = await movementsCollection.insertOne(newMovement);
        const createdMovementId = movementResult.insertedId;

        // 3. Update Inventory Record
        const updateResult = await inventoryCollection.findOneAndUpdate(
            { _id: inventoryIdObj },
            { $set: { quantity: newQuantity, updatedAt: new Date() } },
            { returnDocument: 'after' }
        );

        // Check if update was successful (findOne might return null if record deleted between find and update without transaction)
        if (!updateResult.value) {
             // This case is less likely without transactions but good practice
             console.warn(`Inventory record ${inventoryId} was not found during update after movement was logged.`);
             // Decide how to handle - maybe delete the movement? For simplicity, we just return error.
             await movementsCollection.deleteOne({_id: createdMovementId}); // Attempt to rollback movement
             return res.status(404).json({ error: `Inventory record with ID ${inventoryId} not found during final update.` });
        }

        // --- Response ---
        res.status(200).json({ success: true, data: { movementId: createdMovementId.toString() } });

    } catch (error) {
        console.error('Error adjusting inventory:', error);
        res.status(500).json({ error: 'Failed to adjust inventory' });
    }
});

// POST /inventorys/stock/transfer - Transfer stock (Simplified)
router.post('/stock/transfer', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const inventoryCollection = db.collection('inventorys');
        const movementsCollection = db.collection('stock_movements');
        const productsCollection = db.collection('products');
        const locationsCollection = db.collection('locations');
        const ownerFromHeader = req.headers.owner; // Get owner from header

        const { productId, fromLocationId, toLocationId, quantity, notes, referenceId } = req.body;
        const userId = req.user?._id;

        // --- Basic Validation ---
        const productIdObj = safeObjectId(productId);
        const fromLocationIdObj = safeObjectId(fromLocationId);
        const toLocationIdObj = safeObjectId(toLocationId);

        if (!productIdObj || !fromLocationIdObj || !toLocationIdObj) {
            return res.status(400).json({ error: 'Valid productId, fromLocationId, and toLocationId are required.' });
        }
        if (!quantity || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
            return res.status(400).json({ error: 'Quantity must be a positive integer.' });
        }
        if (fromLocationIdObj.equals(toLocationIdObj)) {
            return res.status(400).json({ error: 'Source and destination locations cannot be the same.' });
        }

        // --- Perform Operations Sequentially ---

        // 1. Validate Product and Locations exist AND Check Owner
        const product = await productsCollection.findOne({ _id: productIdObj });
        if (!product) return res.status(404).json({ error: `Product with ID ${productId} not found.` });

        const fromLocation = await locationsCollection.findOne({ _id: fromLocationIdObj });
        if (!fromLocation) return res.status(404).json({ error: `Source location with ID ${fromLocationId} not found.` });
        // Check owner for source location
        if (ownerFromHeader && fromLocation.owner !== ownerFromHeader) {
             return res.status(403).json({ error: `Permission denied: Source location ${fromLocationId} does not belong to the specified owner.` });
        }

        const toLocation = await locationsCollection.findOne({ _id: toLocationIdObj });
        if (!toLocation) return res.status(404).json({ error: `Destination location with ID ${toLocationId} not found.` });
         // Check owner for destination location
        if (ownerFromHeader && toLocation.owner !== ownerFromHeader) {
             return res.status(403).json({ error: `Permission denied: Destination location ${toLocationId} does not belong to the specified owner.` });
        }

        // 2. Find source inventory record & Check stock & Check Owner
        const fromInventory = await inventoryCollection.findOne(
            { productId: productIdObj, locationId: fromLocationIdObj }
        );
        if (!fromInventory) {
            return res.status(400).json({ error: `No inventory record found for product ${productId} at source location ${fromLocationId}.` });
        }
        // Check owner for source inventory
        if (ownerFromHeader && fromInventory.owner !== ownerFromHeader) {
            return res.status(403).json({ error: `Permission denied: Source inventory record does not belong to the specified owner.` });
        }

        if (fromInventory.quantity < quantity) {
            return res.status(400).json({ error: `Insufficient stock for product ${productId} at source location ${fromLocationId}. Available: ${fromInventory.quantity}, Required: ${quantity}` });
        }

        // 3. Find or Create Destination Inventory Record
        // Destination inventory will inherit owner from location/product context or be set here
        let toInventory = await inventoryCollection.findOne(
            { productId: productIdObj, locationId: toLocationIdObj }
        );
        let toInventoryId = null;
        let currentToQuantity = 0;

        if (!toInventory) {
            const newToInventory = {
                productId: productIdObj,
                locationId: toLocationIdObj,
                quantity: 0, // Start at 0 before transfer
                createdAt: new Date(),
                updatedAt: new Date()
                // Add owner to the new inventory record if it doesn't exist
                // It should align with the toLocation's owner
                // owner: toLocation.owner // Or ownerFromHeader if that's the enforced context
            };
            if (ownerFromHeader) {
                 newToInventory.owner = ownerFromHeader; // Assign owner based on the context
            } else if (toLocation.owner) {
                 newToInventory.owner = toLocation.owner; // Assign owner from location if no header provided
            }
            const insertResult = await inventoryCollection.insertOne(newToInventory);
            toInventoryId = insertResult.insertedId;
            currentToQuantity = 0;
            // Need the newly created/found record for owner check later if needed, but ID is main part
            toInventory = newToInventory; // Use the newly created object structure
            toInventory._id = toInventoryId; // Add the ID
        } else {
            toInventoryId = toInventory._id;
            currentToQuantity = toInventory.quantity;
            // Check owner of existing destination inventory (optional but good practice)
             if (ownerFromHeader && toInventory.owner !== ownerFromHeader) {
                 // This scenario might indicate inconsistent data if locations were checked
                 console.warn(`Warning: Destination inventory ${toInventoryId} owner mismatch for owner ${ownerFromHeader}`);
                 // Decide whether to block or proceed. Blocking might be safer.
                 // return res.status(403).json({ error: `Permission denied: Destination inventory record owner mismatch.` });
            }
        }


        // 4. Calculate new quantities
        const newFromQuantity = fromInventory.quantity - quantity;
        const newToQuantity = currentToQuantity + quantity;

        // 5. Create TRANSFER_OUT movement (LOGGING 1)
        const transferOutMovement = {
            productId: productIdObj,
            locationId: fromLocationIdObj,
            inventoryId: fromInventory._id,
            type: 'TRANSFER_OUT',
            quantityChange: -quantity,
            quantityAfter: newFromQuantity,
            notes: notes || `Transfer to ${toLocation.name}`,
            referenceId: referenceId ? safeObjectId(referenceId) : null,
            timestamp: new Date(),
            userId: userId || null
        };
        // Add owner if present
        if (ownerFromHeader) {
            transferOutMovement.owner = ownerFromHeader;
        }
        const outResult = await movementsCollection.insertOne(transferOutMovement);
        const transferOutMovementId = outResult.insertedId;

        // 6. Create TRANSFER_IN movement (LOGGING 2)
        const transferInMovement = {
            productId: productIdObj,
            locationId: toLocationIdObj,
            inventoryId: toInventoryId, // Use the ID of the destination inventory record
            type: 'TRANSFER_IN',
            quantityChange: quantity,
            quantityAfter: newToQuantity,
            notes: notes || `Transfer from ${fromLocation.name}`,
            referenceId: referenceId ? safeObjectId(referenceId) : null,
            timestamp: new Date(),
            userId: userId || null
        };
         // Add owner if present
        if (ownerFromHeader) {
            transferInMovement.owner = ownerFromHeader;
        }
        const inResult = await movementsCollection.insertOne(transferInMovement);
        const transferInMovementId = inResult.insertedId;

        // 7. Update source inventory quantity
        const updateFromResult = await inventoryCollection.updateOne(
            { _id: fromInventory._id },
            { $set: { quantity: newFromQuantity, updatedAt: new Date() } }
        );
        // Optional: Check updateFromResult.modifiedCount === 1

        // 8. Update destination inventory quantity
        const updateToResult = await inventoryCollection.updateOne(
            { _id: toInventoryId },
            { $set: { quantity: newToQuantity, updatedAt: new Date() } }
            // Optionally add $setOnInsert if creating and updating in one go (upsert logic)
        );
        // Optional: Check updateToResult.modifiedCount === 1

        // --- Response ---
        res.status(200).json({
            success: true,
            message: 'Stock transferred successfully.',
            data: {
                transferOutMovementId: transferOutMovementId.toString(),
                transferInMovementId: transferInMovementId.toString()
            }
        });

    } catch (error) {
        console.error('Error transferring stock:', error);
        res.status(500).json({ error: 'Failed to transfer stock' });
    }
});

// POST /inventorys/stock/movement - Adjust stock using quantityChange
router.post('/stock/movement', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const inventoryCollection = db.collection('inventorys');
        const movementsCollection = db.collection('stock_movements');
        const ownerFromHeader = req.headers.owner; // Get owner from header

        // Extract data from request body (expecting quantityChange and type)
        const { inventoryId, type, reason, quantityChange, notes } = req.body;
        const userId = req.user?._id;

        // --- Validation ---
        const inventoryIdObj = safeObjectId(inventoryId);
        if (!inventoryIdObj) {
            return res.status(400).json({ error: 'Valid inventoryId is required.' });
        }
        // Validate quantityChange (must be an integer, can be positive or negative)
        if (quantityChange == null || typeof quantityChange !== 'number' || !Number.isInteger(quantityChange)) {
            return res.status(400).json({ error: 'quantityChange is required and must be an integer.' });
        }
         // Validate type (optional, but if provided should be meaningful)
        const movementType = typeof type === 'string' ? type.toUpperCase() : 'ADJUSTMENT'; // Default to ADJUSTMENT if type missing/invalid
        // Validate reason
        if (!reason || typeof reason !== 'string' || reason.trim() === '') {
            return res.status(400).json({ error: 'Reason code is required.' });
        }


        // --- Perform Operations Sequentially ---
        // 1. Find Inventory Record
        const inventoryRecord = await inventoryCollection.findOne({ _id: inventoryIdObj });
        if (!inventoryRecord) {
            return res.status(404).json({ error: `Inventory record with ID ${inventoryId} not found.` });
        }

        // --- Owner Check ---
        // Check if the owner from the header matches the owner stored on the inventory record
        if (ownerFromHeader && inventoryRecord.owner !== ownerFromHeader) {
             return res.status(403).json({ error: 'Permission denied: Inventory record does not belong to the specified owner.' });
        }
        // Proceed if no owner filter or if owner matches


        // 2. Calculate new quantity
        const currentQuantity = inventoryRecord.quantity;
        const newQuantity = currentQuantity + quantityChange; // Calculate final quantity

        // Validate that the new quantity is not negative
        if (newQuantity < 0) {
            return res.status(400).json({ error: `Adjustment results in negative stock (${newQuantity}). Current quantity: ${currentQuantity}, Change: ${quantityChange}` });
        }

        // 3. Create Stock Movement Record (LOGGING)
        const newMovement = {
            productId: inventoryRecord.productId,
            locationId: inventoryRecord.locationId,
            inventoryId: inventoryIdObj,
            // Use a standard type like ADJUSTMENT, or use the provided type if you want more granularity
            type: movementType, // Use validated/defaulted type
            quantityChange: quantityChange, // Log the actual change amount received
            quantityAfter: newQuantity,     // Log the final quantity after change
            reason: reason.trim(),
            notes: notes || null,
            timestamp: new Date(),
            userId: userId || null
        };
        // Add owner if present
        if (ownerFromHeader) {
            newMovement.owner = ownerFromHeader;
        }
        const movementResult = await movementsCollection.insertOne(newMovement);
        const createdMovementId = movementResult.insertedId;

        // 4. Update Inventory Record quantity
        const updateResult = await inventoryCollection.findOneAndUpdate(
            { _id: inventoryIdObj },
            { $set: { quantity: newQuantity, updatedAt: new Date() } },
            { returnDocument: 'after' }
        );

        // Check if update was successful
        if (!updateResult.value) {
             console.warn(`Inventory record ${inventoryId} was not found during update after movement was logged.`);
             await movementsCollection.deleteOne({_id: createdMovementId}); // Attempt rollback
             return res.status(404).json({ error: `Inventory record with ID ${inventoryId} not found during final update.` });
        }

        // --- Response ---
        res.status(200).json({ success: true, data: { movementId: createdMovementId.toString() } });

    } catch (error) {
        console.error('Error processing stock movement:', error);
        res.status(500).json({ error: 'Failed to process stock movement' });
    }
});

// --- Other Inventory Related Endpoints (e.g., GET current inventory levels) ---

// GET /inventorys - Get current stock levels with Product Details and calculate Total Stock Value
router.get('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const inventoryCollection = db.collection('inventorys');
        const ownerFilter = req.headers.owner; // Get owner from header

        // --- Build the initial match stage for the aggregation ---
        // This is more complex because the 'owner' field is in the 'locations' collection
        // We'll apply the owner filter *after* looking up location details.

        // Aggregation pipeline to fetch inventory levels and calculate line value
        const pipeline = [
            // Initial match can be used for other inventory filters if needed
            { $match: {} }, 
            {
                $lookup: {
                    from: 'products',
                    localField: 'productId',
                    foreignField: '_id',
                    as: 'productDetails'
                }
            },
            {
                $lookup: {
                    from: 'locations',
                    localField: 'locationId',
                    foreignField: '_id',
                    as: 'locationDetails'
                }
            },
            { $unwind: { path: "$productDetails", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$locationDetails", preserveNullAndEmptyArrays: true } },

            // --- Add owner filter stage HERE, after location details are available ---
            // Conditionally add the match stage only if ownerFilter exists
            ...(ownerFilter ? [
                {
                    $match: {
                        "locationDetails.owner": ownerFilter // Filter based on owner in the looked-up location
                    }
                }
            ] : []), // If no ownerFilter, this adds an empty array (no extra stage)

            {
                $project: { // Select, reshape, and calculate line value
                    _id: 1,
                    quantity: 1,
                    productId: 1,
                    locationId: 1,
                    productSKU: "$productDetails.sku",
                    productDescription: "$productDetails.description",
                    productUnit: "$productDetails.unit",
                    retailPrice: "$productDetails.retailPrice", // Include retail price for calculation
                    locationName: "$locationDetails.name",
                    locationOwner: "$locationDetails.owner", // Optionally include owner
                    updatedAt: 1,
                    // Calculate line value: quantity * retailPrice (handle missing/null price)
                    lineValue: {
                        $multiply: [
                            "$quantity", // Assume quantity is always a number
                            { $ifNull: ["$productDetails.retailPrice", 0] } // Treat missing/null retailPrice as 0
                        ]
                    },
                    // Add the 'type' field based on the 'variations' field from the original inventory document
                    type: {
                        $cond: {
                            if: {
                                $and: [
                                    { $isArray: "$variations" }, // Check if 'variations' is an array
                                    { $gt: [ { $size: { $ifNull: ["$variations", []] } }, 0 ] } // Check if array size > 0 (handle null variations)
                                ]
                            },
                            then: "variations", // If it's a non-empty array
                            else: "simple"      // Otherwise
                        }
                    }
                }
            },
            { $sort: { locationName: 1, productSKU: 1 } } // Example sort
        ];

        const inventoryLevelsWithValue = await inventoryCollection.aggregate(pipeline).toArray();

        // Calculate the total stock value by summing up lineValue
        let totalStockValue = 0;
        inventoryLevelsWithValue.forEach(item => {
            // Ensure lineValue is a valid number before adding
            if (typeof item.lineValue === 'number' && !isNaN(item.lineValue)) {
                totalStockValue += item.lineValue;
            }
        });

        // Send response including the list and the total value
        res.status(200).json({
            success: true,
            data: inventoryLevelsWithValue, // The detailed list of inventory levels with line value and type
            totalStockValue: totalStockValue // The grand total value of all stock
        });

    } catch (error) {
        console.error('Error fetching inventory levels:', error);
        res.status(500).json({ error: 'Failed to fetch inventory levels' });
    }
});


// GET /inventorys/movements - Get stock movements (example with filters)
router.get('/movements', async (req, res) => {
     try {
        const db = req.client.db('dss');
        const movementsCollection = db.collection('stock_movements');
        const { productId, locationId, type, limit = 50 } = req.query; // Example query params
        const ownerFilter = req.headers.owner; // Get owner from header

        const query = {};
        if (productId) query.productId = safeObjectId(productId);
        if (locationId) query.locationId = safeObjectId(locationId);
        if (type) query.type = type;
        // Note: Owner filter is applied after location lookup

        const pipeline = [
             { $match: query }, // Initial match based on query params
             { $sort: { timestamp: -1 } }, // Sort by newest first
             { $limit: parseInt(limit, 10) }, // Limit results
             // Add $lookup stages here if you need to populate product/location names
             {
                 $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'productDetails'}
             },
             {
                 $lookup: { from: 'locations', localField: 'locationId', foreignField: '_id', as: 'locationDetails'}
             },
             {
                 $unwind: { path: "$productDetails", preserveNullAndEmptyArrays: true }
             },
              {
                 $unwind: { path: "$locationDetails", preserveNullAndEmptyArrays: true }
             },
             // --- Add owner filter stage HERE ---
             ...(ownerFilter ? [
                {
                    $match: {
                        "locationDetails.owner": ownerFilter
                    }
                }
             ] : []),
             // Add $lookup for users if needed
             {
                 $project: {
                     _id: 1, type: 1, quantityChange: 1, quantityAfter: 1,
                     reason: 1, notes: 1, referenceId: 1, timestamp: 1,
                     productId: 1, locationId: 1, inventoryId: 1, userId: 1,
                     productSKU: "$productDetails.sku",
                     locationName: "$locationDetails.name",
                     locationOwner: "$locationDetails.owner", // Optionally include owner
                     // Add user details if lookup is done
                 }
             }
        ];

        const movements = await movementsCollection.aggregate(pipeline).toArray();

        res.status(200).json({ success: true, data: movements });
    } catch (error) {
        console.error('Error fetching stock movements:', error);
        res.status(500).json({ error: 'Failed to fetch stock movements' });
    }
});

// --- Get Latest 5 Movements for a Specific Product ---
// GET /inventorys/movements/product/:productId/latest
router.get('/movements/product/:productId/latest', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const movementsCollection = db.collection('stock_movements');
        const productId = safeObjectId(req.params.productId);
        const ownerFilter = req.headers.owner; // Get owner from header

        // --- Validation ---
        if (!productId) {
            return res.status(400).json({ error: 'Invalid Product ID format.' });
        }

        // --- Aggregation Pipeline ---
        const pipeline = [
            // 1. Match movements for the specific product ID
            { $match: { productId: productId } },
            // 2. Sort by timestamp descending (newest first)
            { $sort: { timestamp: -1 } },
            // Note: Limit is applied *after* owner filter to ensure 5 relevant movements
            // 4. Optional: Lookup related data (like the general /movements endpoint)
            {
                $lookup: { from: 'locations', localField: 'locationId', foreignField: '_id', as: 'locationDetails'}
            },
            {
                $unwind: { path: "$locationDetails", preserveNullAndEmptyArrays: true }
            },
            // --- Add owner filter stage HERE ---
             ...(ownerFilter ? [
                {
                    $match: {
                        "locationDetails.owner": ownerFilter
                    }
                }
             ] : []),
            // 3. Limit to the latest 5 documents *after* filtering
            { $limit: 5 },
            // Optional: Lookup users if you store userId and have a users collection
            // { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'userDetails'} },
            // { $unwind: { path: "$userDetails", preserveNullAndEmptyArrays: true } },
            {
                // 5. Project the desired fields
                $project: {
                    _id: 1,
                    type: 1,
                    quantityChange: 1,
                    quantityAfter: 1,
                    reason: 1,
                    notes: 1,
                    referenceId: 1,
                    timestamp: 1,
                    locationId: 1,
                    inventoryId: 1,
                    userId: 1, // Keep userId, lookup user name if needed
                    variationSku: { $ifNull: ["$variationSku", null] }, // Include variationSku if present
                    locationName: "$locationDetails.name",
                    locationOwner: "$locationDetails.owner", // Optionally include owner
                    // userName: "$userDetails.name" // Example if user lookup is added
                    // Exclude productDetails lookup as we already know the productId
                }
            }
        ];

        const latestMovements = await movementsCollection.aggregate(pipeline).toArray();

        // --- Response ---
        // Returns an array (potentially empty if no movements found)
        res.status(200).json({ success: true, data: latestMovements });

    } catch (error) {
        console.error(`Error fetching latest movements for product ${req.params.productId}:`, error);
        res.status(500).json({ error: 'Failed to fetch latest stock movements for the product' });
    }
});

// --- Get Full Movement History for a Specific Inventory Item ---
// GET /inventorys/history/:inventoryId
router.get('/history/:inventoryId', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const movementsCollection = db.collection('stock_movements');
        const inventoryCollection = db.collection('inventorys');
        const locationsCollection = db.collection('locations'); // Needed for owner check
        const productsCollection = db.collection('products');
        const inventoryId = safeObjectId(req.params.inventoryId);
        const ownerFilter = req.headers.owner; // Get owner from header

        // --- Validation ---
        if (!inventoryId) {
            return res.status(400).json({ error: 'Invalid Inventory ID format.' });
        }

        // --- Check if the inventory record itself exists AND check owner --- 
        const inventoryRecord = await inventoryCollection.findOne({ _id: inventoryId });
        if (!inventoryRecord) {
            return res.status(404).json({ error: `Inventory record with ID ${req.params.inventoryId} not found.` });
        }

        // --- Owner Check --- 
        if (ownerFilter && inventoryRecord.locationId) {
            const location = await locationsCollection.findOne({ _id: inventoryRecord.locationId });
            if (!location) {
                // Should not happen if data is consistent, but handle it
                console.warn(`Location ${inventoryRecord.locationId} not found for inventory ${inventoryId}`);
                return res.status(404).json({ error: `Location associated with inventory record not found.` });
            }
            if (location.owner !== ownerFilter) {
                // Owner in header doesn't match the owner of the location for this inventory item
                return res.status(403).json({ error: 'Access denied. Inventory item does not belong to the specified owner.' });
            }
        }
        // Proceed if no owner filter or if owner matches

        const productId = inventoryRecord.productId; // Get productId from inventory record

        // --- Fetch Product Details ---
        let productData = {};
        if (productId) {
            productData = await productsCollection.findOne({ _id: productId });
            if (!productData) {
                console.warn(`Product with ID ${productId} not found for inventory ${inventoryId}`);
                productData = {};
            }
        } else {
             console.warn(`Inventory record ${inventoryId} does not have a productId.`);
        }

        // --- Aggregation Pipeline to fetch all movements for this inventory ID --- 
        const movementHistory = await movementsCollection.aggregate([
            // 1. Match movements for the specific inventory ID
            { $match: { inventoryId: inventoryId } },
            // 2. Sort by timestamp ascending (oldest first for history)
            { $sort: { timestamp: 1 } },
            // 3. Optional: Lookup related data (Location, User)
            {
                $lookup: { from: 'locations', localField: 'locationId', foreignField: '_id', as: 'locationDetails'}
            },
            // No need to filter owner here again, already checked access above
            // { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'userDetails'} },
            { $unwind: { path: "$locationDetails", preserveNullAndEmptyArrays: true } },
            // { $unwind: { path: "$userDetails", preserveNullAndEmptyArrays: true } },
            {
                // 4. Project the desired fields for history
                $project: {
                    _id: 1,
                    type: 1,
                    quantityChange: 1,
                    quantityAfter: 1,
                    reason: 1,
                    notes: 1,
                    referenceId: 1,
                    timestamp: 1,
                    inventoryId: 1,
                    userId: 1,
                    locationName: "$locationDetails.name",
                    locationOwner: "$locationDetails.owner", // Optionally include owner
                    // userName: "$userDetails.name"
                    variationSku: { $ifNull: ["$variationSku", null] },
                }
            }
        ]).toArray();

        // --- Response ---
        res.status(200).json({
            success: true,
            data: {
                product: productData,
                history: movementHistory
            }
        });

    } catch (error) {
        console.error(`Error fetching movement history for inventory ${req.params.inventoryId}:`, error);
        res.status(500).json({ error: 'Failed to fetch stock movement history' });
    }
});

// --- Product Catalog Endpoint (within Inventory context) ---

// GET /inventorys/products/:filterType - List products based on filter ('all' or 'new')
router.get('/products/:filterType', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const productsCollection = db.collection('products');
        const filterType = req.params.filterType;
        const ownerFilter = req.headers.owner; // Get owner from header

        if (filterType === 'all') {
            // --- Logic for fetching ALL products, potentially filtered by owner based on inventory location --- 
            const billsCollection = db.collection('bills');
            const inventoryCollection = db.collection('inventorys'); // Needed for owner filtering

            // 1. Aggregate related bill details per product ID (No change here)
            const billDetailsPerProduct = await billsCollection.aggregate([
                { $unwind: "$items" },
                { $match: { "items.productId": { $exists: true, $ne: null, $ne: "" } } },
                { $group: {
                    _id: "$items.productId",
                    relatedBills: { $push: { /* bill fields */ } }
                }}
            ]).toArray();
            const billDetailsMap = new Map(/* ... map creation ... */);
            // Note: The above aggregation for bills remains the same. Need to adapt the product query below.

            // 2. Build Product Aggregation Pipeline with Owner Filter
            const productPipeline = [
                // Start with products
                { $match: {} }, // Can add other product-level filters here if needed
                 // Lookup inventory items for each product
                {
                    $lookup: {
                        from: 'inventorys',
                        localField: '_id',
                        foreignField: 'productId',
                        as: 'inventoryData'
                    }
                },
                // Unwind inventory data to check each location
                { $unwind: { path: "$inventoryData", preserveNullAndEmptyArrays: true } }, // Keep products even if no inventory
                // Lookup location for the inventory item
                {
                    $lookup: {
                        from: 'locations',
                        localField: 'inventoryData.locationId',
                        foreignField: '_id',
                        as: 'locationDetails'
                    }
                },
                { $unwind: { path: "$locationDetails", preserveNullAndEmptyArrays: true } }, // Keep if inventory exists but location missing?

                 // --- Apply Owner Filter Stage ---
                 // Filter the *joined documents* based on owner. We only want products that exist
                 // in at least one location matching the owner (if filter is provided).
                 ...(ownerFilter ? [
                    {
                        $match: {
                            // Match if EITHER there's no inventoryData (product hasn't been filtered out yet)
                            // OR the location owner matches the filter.
                            // This logic is tricky. Let's filter directly.
                            // We need to group back later.
                            "locationDetails.owner": ownerFilter
                        }
                    }
                 ] : []),

                // --- Group back by Product ID ---
                // We need to reconstruct the product document after potentially filtering based on location owner.
                // If a product exists ONLY in locations NOT matching the owner, it should be excluded entirely.
                {
                    $group: {
                        _id: "$_id", // Group by the original product ID
                        // Keep the first instance of product fields (they are the same for the same _id)
                        doc: { $first: "$$ROOT" },
                        // Check if *any* of the locations matched the owner (if filter applied)
                        matchedOwnerLocation: { $first: "$locationDetails" } // Capture one matching location if filter applied
                    }
                },
                // --- Second Match: Keep only products that had a matching location (if filter was active) ---
                ...(ownerFilter ? [
                    {
                       $match: {
                            "matchedOwnerLocation": { $exists: true, $ne: null } // Ensure we found a location matching the owner
                       }
                    }
                ] : []),
                // Replace root with the original product document
                { $replaceRoot: { newRoot: "$doc" } },
                // Remove temporary fields if necessary (locationDetails is already part of doc)
                // Project final product fields + add bills
                 { $project: { inventoryData: 0, locationDetails: 0, matchedOwnerLocation: 0 } }, // Clean up intermediate fields
                 { $sort: { sku: 1 } } // Sort final product list
            ];

             // Execute the product pipeline
            const products = await productsCollection.aggregate(productPipeline).toArray();

            // 3. Combine product data with related bill details (only for filtered products)
            const productsWithBillDetails = products.map(product => {
                const productIdString = product._id.toString();
                const relatedBillList = billDetailsMap.get(productIdString) || [];
                return { ...product, relatedBills: relatedBillList };
            });

            // 4. Send the response for 'all' filtered products
            res.status(200).json({ success: true, data: productsWithBillDetails });

        } else if (filterType === 'new') {
            // --- Logic for fetching only NEW products (not in inventorys) --- 
            // Owner filter is NOT applied here
            const uninitializedProducts = await productsCollection.aggregate([
                {
                    $lookup: {
                        from: "inventorys", localField: "_id",
                        foreignField: "productId", as: "inventoryData"
                    }
                },
                { $match: { inventoryData: { $eq: [] } } },
                { $project: { inventoryData: 0 } },
                { $sort: { sku: 1 } }
            ]).toArray();

            res.status(200).json({ success: true, data: uninitializedProducts });

        } else {
            res.status(400).json({ error: 'Invalid filter type specified. Use "all" or "new".' });
        }

    } catch (error) {
        console.error(`Error fetching products with filter "${req.params.filterType}":`, error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// GET /inventorys/products/details/:id - Get single product details with all its inventory levels
router.get('/products/details/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const productsCollection = db.collection('products');
        const inventoryCollection = db.collection('inventorys');
        const ownerFilter = req.headers.owner; // Get owner from header

        const productId = safeObjectId(req.params.id);
        if (!productId) {
            return res.status(400).json({ error: 'Invalid Product ID format.' });
        }

        // 1. Fetch product details
        const productData = await productsCollection.findOne({ _id: productId });
        if (!productData) {
            return res.status(404).json({ error: 'Product not found.' });
        }

        // 2. Fetch inventory records for this product, populating location names and filtering by owner
        const inventoryPipeline = [
            { $match: { productId: productId } },
            { $lookup: { from: 'locations', localField: 'locationId', foreignField: '_id', as: 'locationDetails' } },
            { $unwind: { path: "$locationDetails", preserveNullAndEmptyArrays: true } },
            // --- Add owner filter stage HERE ---
             ...(ownerFilter ? [
                {
                    $match: {
                        "locationDetails.owner": ownerFilter
                    }
                }
             ] : []),
            { $project: { _id: 1, locationId: 1, quantity: 1, locationName: "$locationDetails.name", locationOwner: "$locationDetails.owner", updatedAt: 1 } },
            { $sort: { locationName: 1 } }
        ];

        const inventoryLevels = await inventoryCollection.aggregate(inventoryPipeline).toArray();

        // 3. Combine product data with its (potentially filtered) inventory levels
        const responseData = {
            ...productData,
            inventoryLevels: inventoryLevels
        };

        res.status(200).json({ success: true, data: responseData });

    } catch (error) {
        console.error('Error fetching product details with inventory:', error);
        res.status(500).json({ error: 'Failed to fetch product details' });
    }
});

module.exports = router; 