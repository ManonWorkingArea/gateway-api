const express = require('express');
const { ObjectId } = require('mongodb');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path as needed
const router = express.Router();

const SUPPLIERS_COLLECTION = 'suppliers';
const PRODUCTS_COLLECTION = 'products'; // Added for product count

// --- Ensure Collection Exists (Helper Function) ---
// Consider moving this to a shared utility or startup script
async function ensureSuppliersCollection(db) {
    const collections = await db.listCollections({ name: SUPPLIERS_COLLECTION }).toArray();
    if (collections.length === 0) {
        console.log(`Creating collection: ${SUPPLIERS_COLLECTION}`);
        // Add schema validation if desired
        await db.createCollection(SUPPLIERS_COLLECTION);
        // Add indexes if needed, e.g., on 'owner' and 'name'
        await db.collection(SUPPLIERS_COLLECTION).createIndex({ owner: 1 });
        await db.collection(SUPPLIERS_COLLECTION).createIndex({ owner: 1, name: 1 }, { unique: true }); // Unique name per owner
    }
}

// --- GET /suppliers (List Suppliers with Product Count) ---
router.get('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        await ensureSuppliersCollection(db);
        const suppliersCollection = db.collection(SUPPLIERS_COLLECTION);
        const productsCollection = db.collection(PRODUCTS_COLLECTION); // Get products collection
        const ownerFromHeader = req.headers.owner;

        const filter = {};
        if (ownerFromHeader && typeof ownerFromHeader === 'string' && ownerFromHeader.trim() !== '') {
            filter.owner = ownerFromHeader.trim();
            console.log(`[LOG] GET /suppliers: Filtering by owner: ${filter.owner}`);
        } else {
             console.log(`[LOG] GET /suppliers: No valid owner header. Fetching all accessible suppliers.`);
             // Consider owner mandatory? return res.status(400)...
        }

        // 1. Fetch Suppliers
        const suppliers = await suppliersCollection.find(filter).sort({ name: 1 }).toArray();

        if (suppliers.length === 0) {
            return res.status(200).json({ success: true, data: [] }); // Return empty if no suppliers found
        }

        // 2. Get Supplier IDs (as strings)
        const supplierIdStrings = suppliers.map(s => s._id.toString());

        // 3. Aggregate Product Counts
        let productCountMap = new Map();
        try {
            const productCounts = await productsCollection.aggregate([
                {
                    $match: {
                        owner: filter.owner, // Match products by the same owner
                        supplierIds: { $in: supplierIdStrings } // Match products linked to these suppliers
                    }
                },
                { $project: { supplierIds: 1, _id: 0 } }, // Project only needed field
                { $unwind: "$supplierIds" },             // Deconstruct the array
                {
                    $match: {
                        supplierIds: { $in: supplierIdStrings } // Ensure unwound ID is relevant
                    }
                },
                {
                    $group: {
                        _id: "$supplierIds",           // Group by supplier ID (string)
                        productCount: { $sum: 1 }      // Count occurrences
                    }
                }
            ]).toArray();

            // Create map: supplierId -> count
            productCounts.forEach(item => {
                productCountMap.set(item._id, item.productCount);
            });
             console.log("[LOG] Product counts aggregated:", productCountMap);

        } catch (aggError) {
             console.error('Error aggregating product counts for suppliers:', aggError);
             // Continue without counts if aggregation fails
        }

        // 4. Combine Suppliers with Counts
        const suppliersWithCounts = suppliers.map(supplier => ({
            ...supplier,
            productCount: productCountMap.get(supplier._id.toString()) || 0 // Add count, default 0
        }));

        res.status(200).json({ success: true, data: suppliersWithCounts });

    } catch (error) {
        console.error('Error fetching suppliers:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch suppliers' });
    }
});

// --- GET /suppliers/:id (Get Single Supplier) ---
router.get('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        await ensureSuppliersCollection(db);
        const suppliersCollection = db.collection(SUPPLIERS_COLLECTION);
        const ownerFromHeader = req.headers.owner;
        const supplierId = safeObjectId(req.params.id);

        if (!supplierId) {
            return res.status(400).json({ success: false, error: 'Invalid Supplier ID format.' });
        }

        const supplier = await suppliersCollection.findOne({ _id: supplierId });

        if (!supplier) {
            return res.status(404).json({ success: false, error: 'Supplier not found.' });
        }

        // Authorization Check
        if (ownerFromHeader && supplier.owner !== ownerFromHeader) {
            console.warn(`[AUTH] Attempt to access supplier ${supplierId} by non-owner ${ownerFromHeader}. Supplier owner: ${supplier.owner}`);
            return res.status(403).json({ success: false, error: 'Permission denied: You do not own this supplier.' });
        }
        // If owner is always required:
        // if (!ownerFromHeader || supplier.owner !== ownerFromHeader) { ... return 403 ... }

        res.status(200).json({ success: true, data: supplier });

    } catch (error) {
        console.error(`Error fetching supplier ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Failed to fetch supplier' });
    }
});


// --- POST /suppliers (Add New Supplier) ---
router.post('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        await ensureSuppliersCollection(db);
        const suppliersCollection = db.collection(SUPPLIERS_COLLECTION);
        const ownerFromHeader = req.headers.owner; // Use header for owner assignment

        const { name, contactPerson, email, phone, address, taxId, website, status, notes, balanceSheets } = req.body;

        // --- Validation ---
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ success: false, error: 'Supplier name is required.' });
        }
        if (!ownerFromHeader || typeof ownerFromHeader !== 'string' || ownerFromHeader.trim() === '') {
             // Make owner mandatory from header for creation
             return res.status(400).json({ success: false, error: 'Owner header is required to create a supplier.' });
        }

        const trimmedName = name.trim();
        const ownerValue = ownerFromHeader.trim();

        // Basic email validation (optional)
        // if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { ... }
         // Basic URL validation (optional)
        // if (website) { try { new URL(website); } catch { ... } }

        // Check for duplicates (same name for the same owner)
        const existingSupplier = await suppliersCollection.findOne({
            owner: ownerValue,
            name: { $regex: `^${trimmedName}$`, $options: 'i' } // Case-insensitive check
        });
        if (existingSupplier) {
            return res.status(400).json({ success: false, error: `Supplier with name "${trimmedName}" already exists for this owner.` });
        }
        // --- End Validation ---

        const newSupplier = {
            name: trimmedName,
            contactPerson: contactPerson?.trim() || null,
            email: email?.trim() || null,
            phone: phone?.trim() || null,
            address: {
                street: address?.street?.trim() || null,
                city: address?.city?.trim() || null,
                state: address?.state?.trim() || null,
                postalCode: address?.postalCode?.trim() || null,
                country: address?.country?.trim() || 'ไทย', // Default
            },
            taxId: taxId?.trim() || null,
            website: website?.trim() || null,
            status: ['active', 'inactive'].includes(status) ? status : 'active', // Default to active
            notes: notes?.trim() || null,
            balanceSheets: balanceSheets || null,
            owner: ownerValue, // Assign owner from header
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await suppliersCollection.insertOne(newSupplier);
        const createdSupplier = await suppliersCollection.findOne({ _id: result.insertedId });

        res.status(201).json({ success: true, data: createdSupplier });

    } catch (error) {
        console.error('Error adding supplier:', error);
        // Handle specific errors like unique index violation (code 11000)
         if (error.code === 11000) {
              return res.status(400).json({ success: false, error: 'A supplier with this name might already exist for the owner (database constraint).' });
         }
        res.status(500).json({ success: false, error: 'Failed to add supplier' });
    }
});

// --- PUT /suppliers/:id (Update Supplier) ---
router.put('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        await ensureSuppliersCollection(db);
        const suppliersCollection = db.collection(SUPPLIERS_COLLECTION);
        const ownerFromHeader = req.headers.owner;
        const supplierId = safeObjectId(req.params.id);

        if (!supplierId) {
            return res.status(400).json({ success: false, error: 'Invalid Supplier ID format.' });
        }

        const updatePayload = req.body;
        if (Object.keys(updatePayload).length === 0) {
            return res.status(400).json({ success: false, error: 'Update payload cannot be empty.' });
        }

        // --- Authorization and Existence Check ---
        const currentSupplier = await suppliersCollection.findOne({ _id: supplierId });
        if (!currentSupplier) {
            return res.status(404).json({ success: false, error: 'Supplier not found.' });
        }
        if (ownerFromHeader && currentSupplier.owner !== ownerFromHeader) {
            console.warn(`[AUTH] Attempt to update supplier ${supplierId} by non-owner ${ownerFromHeader}. Supplier owner: ${currentSupplier.owner}`);
            return res.status(403).json({ success: false, error: 'Permission denied: You do not own this supplier.' });
        }
         // If owner is always required:
        // if (!ownerFromHeader || currentSupplier.owner !== ownerFromHeader) { ... return 403 ... }
        // --- End Auth Check ---

        // --- Prepare Update Data and Validate ---
        const updateData = {};
        let newName = currentSupplier.name;
        let hasChanges = false;

        // Validate and add fields to updateData
        if (updatePayload.name !== undefined) {
            const trimmedName = String(updatePayload.name).trim();
            if (trimmedName === '') return res.status(400).json({ success: false, error: 'Supplier name cannot be empty.' });
            if (trimmedName !== currentSupplier.name) {
                updateData.name = trimmedName;
                newName = trimmedName;
                hasChanges = true;
            }
        }
        // Add other updatable fields (contactPerson, email, phone, etc.)
        const fieldsToUpdate = ['contactPerson', 'email', 'phone', 'taxId', 'website', 'status', 'notes'];
        fieldsToUpdate.forEach(field => {
             if (updatePayload[field] !== undefined) {
                 const value = (updatePayload[field] === null || updatePayload[field] === '') ? null : String(updatePayload[field]).trim();
                  if (field === 'status' && !['active', 'inactive'].includes(value)) {
                      // Skip invalid status update or return error
                      console.warn(`Skipping invalid status update: ${value}`);
                  } else if (value !== currentSupplier[field]) {
                     updateData[field] = value;
                     hasChanges = true;
                 }
             }
        });

        // Handle balanceSheets separately (might be object/array)
        if (updatePayload.balanceSheets !== undefined) {
            const balanceSheetsValue = updatePayload.balanceSheets === null ? null : updatePayload.balanceSheets;
            if (JSON.stringify(balanceSheetsValue) !== JSON.stringify(currentSupplier.balanceSheets)) {
                updateData.balanceSheets = balanceSheetsValue;
                hasChanges = true;
            }
        }

        // Handle address update (update nested fields carefully)
        if (updatePayload.address !== undefined) {
            const addressFields = ['street', 'city', 'state', 'postalCode', 'country'];
            addressFields.forEach(field => {
                if (updatePayload.address[field] !== undefined) {
                    const value = (updatePayload.address[field] === null || updatePayload.address[field] === '') ? null : String(updatePayload.address[field]).trim();
                    if (value !== currentSupplier.address?.[field]) {
                        // Use dot notation for nested field update
                         updateData[`address.${field}`] = value;
                         hasChanges = true;
                    }
                }
            });
             // Ensure country defaults if cleared
             if (updateData['address.country'] === null && currentSupplier.address?.country !== null) {
                 updateData['address.country'] = 'ไทย'; // Re-apply default if cleared, adjust if needed
             }
        }

        // Prevent updating protected fields
        delete updateData._id; // Should not be in payload anyway
        delete updateData.owner;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        if (!hasChanges) {
             return res.status(200).json({ success: true, data: currentSupplier, message: 'No changes detected.' });
        }
        // --- End Prepare Update ---

        // --- Duplicate Check (if name changed) ---
         if (updateData.name !== undefined) {
             const duplicateFilter = {
                 _id: { $ne: supplierId },
                 owner: currentSupplier.owner, // Check within the same owner
                 name: { $regex: `^${newName}$`, $options: 'i' }
             };
             const duplicateExists = await suppliersCollection.findOne(duplicateFilter);
             if (duplicateExists) {
                  return res.status(400).json({ success: false, error: `Another supplier with name "${newName}" already exists for this owner.` });
             }
         }
        // --- End Duplicate Check ---

        // --- Perform Update ---
        const updateResult = await suppliersCollection.updateOne(
            { _id: supplierId },
            { $set: updateData, $currentDate: { updatedAt: true } }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ success: false, error: 'Supplier not found during update attempt.' });
        }
        if (updateResult.modifiedCount === 0 && hasChanges) {
            console.warn(`Supplier ${supplierId} matched but not modified, despite detected changes.`);
            return res.status(200).json({ success: true, data: currentSupplier, message: 'Supplier matched but no update was performed.' });
        }

        const updatedSupplier = await suppliersCollection.findOne({ _id: supplierId });
        res.status(200).json({ success: true, data: updatedSupplier });

    } catch (error) {
        console.error(`Error updating supplier ${req.params.id}:`, error);
        if (error.code === 11000) {
             return res.status(400).json({ success: false, error: 'Update would result in a duplicate supplier name for this owner.' });
        }
        res.status(500).json({ success: false, error: 'Failed to update supplier' });
    }
});

// --- DELETE /suppliers/:id (Delete Supplier) ---
router.delete('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        await ensureSuppliersCollection(db);
        const suppliersCollection = db.collection(SUPPLIERS_COLLECTION);
        const ownerFromHeader = req.headers.owner;
        const supplierId = safeObjectId(req.params.id);

        if (!supplierId) {
            return res.status(400).json({ success: false, error: 'Invalid Supplier ID format.' });
        }

        // --- Authorization and Existence Check ---
        const supplierToDelete = await suppliersCollection.findOne({ _id: supplierId }, { projection: { name: 1, owner: 1 } }); // Fetch only needed fields
        if (!supplierToDelete) {
            return res.status(404).json({ success: false, error: 'Supplier not found.' });
        }
        if (ownerFromHeader && supplierToDelete.owner !== ownerFromHeader) {
            console.warn(`[AUTH] Attempt to DELETE supplier ${supplierId} by non-owner ${ownerFromHeader}. Supplier owner: ${supplierToDelete.owner}`);
            return res.status(403).json({ success: false, error: 'Permission denied: You do not own this supplier.' });
        }
        // If owner is always required:
        // if (!ownerFromHeader || supplierToDelete.owner !== ownerFromHeader) { ... return 403 ... }
        // --- End Auth Check ---

        // --- Dependency Check (Placeholder) ---
        // Check if this supplier is used in bills, purchase orders, etc.
        // Example:
        // const billsCollection = db.collection('bills');
        // const relatedBill = await billsCollection.findOne({ supplierId: supplierId });
        // if (relatedBill) {
        //     return res.status(400).json({ success: false, error: `Cannot delete supplier: It is used in bill "${relatedBill.invoiceId}".` });
        // }
        console.warn(`[DELETE /suppliers/:id] Dependency check not implemented. Deleting supplier ${supplierId} without checking usage.`);
        // --- End Dependency Check ---

        // --- Perform Deletion ---
        const deleteResult = await suppliersCollection.deleteOne({ _id: supplierId });

        if (deleteResult.deletedCount === 0) {
            console.warn(`Supplier ${supplierId} found but delete operation removed 0 documents.`);
            return res.status(404).json({ success: false, error: 'Supplier found but could not be deleted.' });
        }

        res.status(200).json({ success: true, message: `Supplier \"${supplierToDelete.name}\" (ID: ${supplierId}) deleted successfully.`, data: { deletedCount: deleteResult.deletedCount } });

    } catch (error) {
        console.error(`Error deleting supplier ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Failed to delete supplier' });
    }
});

// --- GET /suppliers/:supplierId/products (List Products for a Supplier) ---
router.get('/:supplierId/products', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const suppliersCollection = db.collection(SUPPLIERS_COLLECTION);
        const productsCollection = db.collection(PRODUCTS_COLLECTION);
        const ownerFromHeader = req.headers.owner;
        const supplierId = safeObjectId(req.params.supplierId);

        if (!supplierId) {
            return res.status(400).json({ success: false, error: 'Invalid Supplier ID format.' });
        }

        // --- Optional: Verify Supplier Existence and Ownership ---
        const supplier = await suppliersCollection.findOne({ _id: supplierId }, { projection: { owner: 1 } });
        if (!supplier) {
            return res.status(404).json({ success: false, error: 'Supplier not found.' });
        }
        if (ownerFromHeader && supplier.owner !== ownerFromHeader) {
             console.warn(`[AUTH] Attempt to access products for supplier ${supplierId} by non-owner ${ownerFromHeader}. Supplier owner: ${supplier.owner}`);
             // Depending on policy, could return 403 or just filter products by header owner below
             return res.status(403).json({ success: false, error: 'Permission denied: You do not own this supplier.' });
        }
        // --- End Optional Verification ---

        // --- Find Products Linked to the Supplier ---
        const productFilter = {};
        if (ownerFromHeader) {
            productFilter.owner = ownerFromHeader.trim(); // Filter products by owner
            console.log(`[LOG] GET /suppliers/:id/products: Filtering products by owner: ${productFilter.owner}`);
        } else {
            // Handle case where owner header is missing - fetch all products for the supplier regardless of owner?
             console.warn(`[LOG] GET /suppliers/:id/products: No owner header provided. Fetching products for supplier ${supplierId} across all owners (is this intended?).`);
             // If owner is mandatory for product listing, return error here.
        }

        // Add the supplier ID filter - Assuming supplierIds in products are stored as Strings
        productFilter.supplierIds = supplierId.toString(); // Check if the array contains the string ID
        // Alternatively, if supplierIds are stored as ObjectIds:
        // productFilter.supplierIds = supplierId;

        console.log(`[LOG] Querying products with filter:`, productFilter);

        const products = await productsCollection.find(productFilter).toArray();

        res.status(200).json({ success: true, data: products });

    } catch (error) {
        console.error(`Error fetching products for supplier ${req.params.supplierId}:`, error);
        res.status(500).json({ success: false, error: 'Failed to fetch products for supplier' });
    }
});

module.exports = router; 