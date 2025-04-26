const express = require('express');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path
const { ObjectId } = require('mongodb'); // Import ObjectId
const router = express.Router();
// --- Get Unique Product Categories ---
router.get('/categories', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const categoriesCollection = db.collection('product_categories'); // Target the correct collection
        const ownerFromHeader = req.headers.owner; // Get owner from header

        // Build the filter based on the owner header
        const filter = {};
        if (ownerFromHeader && typeof ownerFromHeader === 'string' && ownerFromHeader.trim() !== '') {
            filter.owner = ownerFromHeader.trim();
            console.log(`[LOG] Filtering categories by owner: ${filter.owner}`);
        } else {
            console.log(`[LOG] No valid owner header provided. Fetching all categories.`);
            // No owner filter applied if header is missing or empty
            // If owner is mandatory for fetching, you might want to return an error here instead.
            // return res.status(400).json({ success: false, error: 'Owner header is required to list categories.' });
        }

        // Fetch documents from the product_categories collection using the filter
        const categories = await categoriesCollection.find(filter).toArray();

        // Optionally sort results
        // categories.sort((a, b) => a.name.localeCompare(b.name));

        res.status(200).json({ success: true, data: categories }); // Return the (potentially filtered) category documents
    } catch (error) {
        console.error('Error fetching product categories:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch product categories' });
    }
});

// POST /products/categories (Add New Category)
router.post('/categories', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const categoriesCollection = db.collection('product_categories');
        const ownerFromHeader = req.headers.owner; // Get owner from header

        const { name, parentId } = req.body;

        // --- Validation ---
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ success: false, error: 'Category name is required and must be a non-empty string.' });
        }
        const trimmedName = name.trim();

        let parentIdObj = null;
        if (parentId !== undefined && parentId !== null) {
            parentIdObj = safeObjectId(parentId);
            if (!parentIdObj) {
                return res.status(400).json({ success: false, error: 'Invalid parentId format.' });
            }
            const parentCategory = await categoriesCollection.findOne({ _id: parentIdObj });
            if (!parentCategory) {
                return res.status(400).json({ success: false, error: `Parent category with ID "${parentId}" not found.` });
            }
            // Optional: Check if parent category has the same owner if owner is mandatory
            // if (ownerFromHeader && parentCategory.owner !== ownerFromHeader) { ... }
        } else {
             parentIdObj = null;
        }

        // Check for duplicates (same name, same parent, same owner? - Let's keep it same name/parent for now)
        const existingFilter = {
            name: { $regex: `^${trimmedName}$`, $options: 'i' },
            parentId: parentIdObj
        };
        // Optional: Add owner check to duplicate check if categories must be unique per owner
        // if (ownerFromHeader) { existingFilter.owner = ownerFromHeader; } 
        const existingCategory = await categoriesCollection.findOne(existingFilter);

        if (existingCategory) {
            const parentMsg = parentIdObj ? `under parent "${parentId}"` : 'at the root level';
            // const ownerMsg = ownerFromHeader ? `for owner "${ownerFromHeader}"` : ''; // Optional owner message
            return res.status(400).json({ success: false, error: `Category with name "${trimmedName}" already exists ${parentMsg}.` });
        }
        // --- End Validation ---

        // Create new category document
        const newCategory = {
            name: trimmedName,
            parentId: parentIdObj,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Add owner if provided in header
        if (ownerFromHeader && typeof ownerFromHeader === 'string' && ownerFromHeader.trim() !== '') {
            newCategory.owner = ownerFromHeader.trim();
            console.log(`[LOG] Adding category with owner: ${newCategory.owner}`);
        } else {
             console.log(`[LOG] Adding category without specific owner.`);
             // Decide if owner is mandatory. If so, return error here.
             // return res.status(400).json({ success: false, error: 'Owner header is required.' });
        }

        const result = await categoriesCollection.insertOne(newCategory);

        const createdCategory = await categoriesCollection.findOne({ _id: result.insertedId });

        res.status(201).json({ success: true, data: createdCategory });
    } catch (error) {
        console.error('Error adding product category:', error);
        res.status(500).json({ success: false, error: 'Failed to add product category' });
    }
});


// PATCH /products/categories/:categoryId (Update Category)
router.patch('/categories/:categoryId', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const categoriesCollection = db.collection('product_categories');
        const ownerFromHeader = req.headers.owner; // Get owner for authorization

        const categoryId = safeObjectId(req.params.categoryId);
        if (!categoryId) {
            return res.status(400).json({ success: false, error: 'Invalid Category ID format.' });
        }

        const updatePayload = req.body;
        if (Object.keys(updatePayload).length === 0) {
            return res.status(400).json({ success: false, error: 'Update payload cannot be empty.' });
        }

        // --- Authorization and Existence Check ---
        const currentCategory = await categoriesCollection.findOne({ _id: categoryId });
        if (!currentCategory) {
            return res.status(404).json({ success: false, error: 'Category not found.' });
        }

        // Check owner if header is provided
        if (ownerFromHeader && currentCategory.owner !== ownerFromHeader) {
             console.warn(`[AUTH] Attempt to update category ${categoryId} by non-owner ${ownerFromHeader}. Category owner: ${currentCategory.owner}`);
             return res.status(403).json({ success: false, error: 'Permission denied: You do not own this category.' });
        }
        // --- End Auth Check ---

        // --- Prepare Update Data and Validate ---
        const updateData = {};
        let newParentIdObj = currentCategory.parentId; // Keep original parent unless updated
        let newName = currentCategory.name; // Keep original name unless updated
        let hasChanges = false;

        // Validate name if provided
        if (updatePayload.name !== undefined) {
            const trimmedName = String(updatePayload.name).trim();
            if (trimmedName === '') {
                return res.status(400).json({ success: false, error: 'Category name cannot be empty.' });
            }
            if (trimmedName !== currentCategory.name) {
                updateData.name = trimmedName;
                newName = trimmedName;
                hasChanges = true;
            }
        }

        // Validate parentId if provided
        if (updatePayload.parentId !== undefined) {
            if (updatePayload.parentId === null) {
                if (currentCategory.parentId !== null) { // Check if it actually changed
                    newParentIdObj = null;
                    updateData.parentId = null;
                    hasChanges = true;
                }
            } else {
                const parentIdObj = safeObjectId(updatePayload.parentId);
                if (!parentIdObj) {
                    return res.status(400).json({ success: false, error: 'Invalid parentId format.' });
                }
                // Prevent setting parent to itself
                if (parentIdObj.equals(categoryId)) {
                    return res.status(400).json({ success: false, error: 'Cannot set a category as its own parent.' });
                }
                // Check if new parent exists and belongs to the same owner (if applicable)
                const newParentCategory = await categoriesCollection.findOne({ _id: parentIdObj });
                if (!newParentCategory) {
                    return res.status(400).json({ success: false, error: `New parent category with ID "${updatePayload.parentId}" not found.` });
                }
                // if (ownerFromHeader && newParentCategory.owner !== ownerFromHeader) { ... check parent owner ... }
                
                // Check if parentId actually changed
                if (!parentIdObj.equals(currentCategory.parentId)) { 
                    newParentIdObj = parentIdObj;
                    updateData.parentId = parentIdObj;
                    hasChanges = true;
                }
            }
        }
        
        // Prevent updating protected fields
        delete updatePayload._id;
        delete updatePayload.owner;
        delete updatePayload.createdAt;
        delete updatePayload.updatedAt;
        
        // Add any other allowed fields from payload to updateData
        for (const key in updatePayload) {
            if (key !== 'name' && key !== 'parentId' && updateData[key] === undefined) { // Avoid overwriting validated fields
                 // Add validation for other fields here if needed
                 updateData[key] = updatePayload[key];
                 hasChanges = true; 
            }
        }
        if (!hasChanges) {
             return res.status(200).json({ success: true, data: currentCategory, message: 'No changes detected.' });
        }
        // --- End Prepare Update ---

        // --- Duplicate Check (if name or parent changed) ---
        if (updateData.name !== undefined || updateData.parentId !== undefined) {
            const duplicateFilter = {
                _id: { $ne: categoryId }, // Exclude the current category
                name: { $regex: `^${newName}$`, $options: 'i' },
                parentId: newParentIdObj
                // Add owner to filter if necessary: owner: ownerFromHeader || currentCategory.owner 
            };
            const duplicateExists = await categoriesCollection.findOne(duplicateFilter);
            if (duplicateExists) {
                 const parentMsg = newParentIdObj ? `under the same parent` : 'at the root level';
                 return res.status(400).json({ success: false, error: `Another category with name "${newName}" already exists ${parentMsg}.` });
            }
        }
        // --- End Duplicate Check ---

        // --- Perform Update ---
        const updateResult = await categoriesCollection.updateOne(
            { _id: categoryId }, // Filter by ID (owner check already done)
            { $set: updateData, $currentDate: { updatedAt: true } }
        );

        if (updateResult.matchedCount === 0) {
            // Should not happen if findOne above worked, but good practice to check
            return res.status(404).json({ success: false, error: 'Category not found during update attempt.' });
        }
        if (updateResult.modifiedCount === 0 && hasChanges) { 
            // This might indicate a concurrent modification or no actual change needed
             console.warn(`Category ${categoryId} matched but not modified, despite detected changes.`);
             // Return the current state as potentially no update was necessary
             return res.status(200).json({ success: true, data: currentCategory, message: 'Category matched but no update was performed.' });
        }

        // Fetch the updated document
        const updatedCategory = await categoriesCollection.findOne({ _id: categoryId });
        res.status(200).json({ success: true, data: updatedCategory });

    } catch (error) {
        console.error(`Error updating category ${req.params.categoryId}:`, error);
        res.status(500).json({ success: false, error: 'Failed to update product category' });
    }
});

// DELETE /products/categories/:categoryId (Delete Category)
router.delete('/categories/:categoryId', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const categoriesCollection = db.collection('product_categories');
        const ownerFromHeader = req.headers.owner; // Get owner for authorization

        const categoryId = safeObjectId(req.params.categoryId);
        if (!categoryId) {
            return res.status(400).json({ success: false, error: 'Invalid Category ID format.' });
        }

        // --- Authorization and Existence Check ---
        const categoryToDelete = await categoriesCollection.findOne({ _id: categoryId });
        if (!categoryToDelete) {
            return res.status(404).json({ success: false, error: 'Category not found.' });
        }

        // Check owner if header is provided
        if (ownerFromHeader && categoryToDelete.owner !== ownerFromHeader) {
             console.warn(`[AUTH] Attempt to DELETE category ${categoryId} by non-owner ${ownerFromHeader}. Category owner: ${categoryToDelete.owner}`);
             return res.status(403).json({ success: false, error: 'Permission denied: You do not own this category.' });
        }
        // --- End Auth Check ---

        // --- Dependency Check ---
        // 1. Check if any other category uses this as a parent
        const childCategory = await categoriesCollection.findOne({ parentId: categoryId });
        if (childCategory) {
            return res.status(400).json({ success: false, error: `Cannot delete category: It is used as a parent by category "${childCategory.name}" (ID: ${childCategory._id}).` });
        }
        // 2. Check if any product uses this category (Placeholder - requires knowing the relationship)
        // Example: Assuming products have a categoryId field referencing product_categories
        // const productUsingCategory = await productsCollection.findOne({ categoryId: categoryId });
        // if (productUsingCategory) {
        //     return res.status(400).json({ success: false, error: `Cannot delete category: It is used by product "${productUsingCategory.name}" (ID: ${productUsingCategory._id}).` });
        // }
        // Example: If products.type stores the category name, check might be more complex
        // const productUsingCategoryName = await productsCollection.findOne({ type: categoryToDelete.name /* case-sensitive? */ });
        // if (productUsingCategoryName) { ... }

        // --- End Dependency Check ---

        // --- Perform Deletion ---
        const deleteResult = await categoriesCollection.deleteOne({ _id: categoryId });

        if (deleteResult.deletedCount === 0) {
            // Should not happen if findOne worked, but good practice
            console.warn(`Category ${categoryId} found but delete operation removed 0 documents.`);
            return res.status(404).json({ success: false, error: 'Category found but could not be deleted.' });
        }

        res.status(200).json({ success: true, message: `Category "${categoryToDelete.name}" (ID: ${categoryId}) deleted successfully.`, data: { deletedCount: deleteResult.deletedCount } });
    } catch (error) {
        console.error(`Error deleting category ${req.params.categoryId}:`, error);
        res.status(500).json({ success: false, error: 'Failed to delete product category' });
    }
});

// POST /products (Add New) - Modified
router.post('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const productsCollection = db.collection('products');
        const attributesCollection = db.collection('product_attributes'); // Need to validate attributeId

        // Ensure products collection exists
        const collections = await db.listCollections({ name: 'products' }).toArray();
        if (collections.length === 0) await db.createCollection('products');

        const { attributes, sku, barcode, ...productData } = req.body; // Separate attributes, sku, and barcode
        const newProduct = { ...productData, createdAt: new Date() };

        // --- SKU Uniqueness Check ---
        if (sku !== undefined && sku !== null && String(sku).trim() !== '') {
            const trimmedSku = String(sku).trim();
            const existingSkuProduct = await productsCollection.findOne({ sku: trimmedSku });
            if (existingSkuProduct) {
                return res.status(400).json({ error: `SKU "${trimmedSku}" already exists for another product.` });
            }
            newProduct.sku = trimmedSku; // Add validated SKU to the new product
        } else {
            // Handle case where SKU might be intentionally null or empty if allowed
            newProduct.sku = sku; // Or set to null explicitly if required
        }
        // --- End SKU Check ---

        // --- Barcode Uniqueness Check ---
        if (barcode !== undefined && barcode !== null && String(barcode).trim() !== '') {
            const trimmedBarcode = String(barcode).trim();
            const existingBarcodeProduct = await productsCollection.findOne({ barcode: trimmedBarcode });
            if (existingBarcodeProduct) {
                return res.status(400).json({ error: `Barcode "${trimmedBarcode}" already exists for another product.` });
            }
            newProduct.barcode = trimmedBarcode; // Add validated Barcode to the new product
        } else {
            // Handle case where Barcode might be intentionally null or empty if allowed
            newProduct.barcode = barcode; // Or set to null explicitly if required
        }
        // --- End Barcode Check ---

        // Validate and prepare attributes array
        const processedAttributes = [];
        if (attributes && Array.isArray(attributes)) {
            for (const attr of attributes) {
                const attributeId = safeObjectId(attr.attributeId);
                const value = attr.value;
                if (!attributeId || value === undefined || typeof value !== 'string' || value.trim() === '') {
                    return res.status(400).json({ error: `Invalid attribute format: attributeId and non-empty string value required for all attributes. Problematic entry: ${JSON.stringify(attr)}` });
                }
                // Check if attributeId exists in master collection
                const masterAttr = await attributesCollection.findOne({_id: attributeId});
                if (!masterAttr) {
                    return res.status(400).json({ error: `Invalid attributeId "${attr.attributeId}" provided. It does not exist.`});
                }
                processedAttributes.push({ attributeId: attributeId, value: value.trim() });
            }
             // Check for duplicate attributeIds within the product
            const attrIds = processedAttributes.map(a => a.attributeId.toString());
            if (new Set(attrIds).size !== attrIds.length) {
                 return res.status(400).json({ error: 'Duplicate attribute types assigned to the same product.' });
            }
        }
        newProduct.attributes = processedAttributes; // Assign validated attributes


        const result = await productsCollection.insertOne(newProduct);
        // Fetch inserted doc to return consistent data
        const createdProduct = await productsCollection.findOne({_id: result.insertedId});
        res.status(201).json({ success: true, data: createdProduct });
    } catch (error) {
        console.error('Error adding new product:', error);
        res.status(500).json({ error: 'Failed to add new product' });
    }
});

// GET /products (List with Bill Details and Total Stock) - Modified for Owner Filter
router.get('/', async (req, res) => {
     try {
        const db = req.client.db('dss');
        const productsCollection = db.collection('products');
        const billsCollection = db.collection('bills');
        const inventoryCollection = db.collection('inventorys'); // Add inventory collection

        // --- Get Owner Filter from Header ---
        const ownerFilterValue = req.headers['owner']; // Access the 'owner' header
        const productFilter = {}; // Initialize empty filter object

        if (ownerFilterValue && typeof ownerFilterValue === 'string' && ownerFilterValue.trim() !== '') {
            productFilter.owner = ownerFilterValue.trim(); // Add owner filter if header is present and not empty
            console.log(`[LOG] Filtering products by owner: ${productFilter.owner}`);
        } else {
            console.log(`[LOG] No valid 'owner' header provided. Fetching all products.`);
            // No owner filter applied, will fetch all products matching other criteria
        }
        // --- End Owner Filter ---

        // 1. Aggregate Bill Details (Existing Logic - No change needed here unless bills also need owner filtering)
        const billDetailsPerProduct = await billsCollection.aggregate([
            { $unwind: "$items" },
            { $match: { "items.productId": { $exists: true, $ne: null, $ne: "" } } }, // Adjusted match
            // If bills also have an owner field and need filtering:
            // { $match: { "items.productId": { $exists: true, $ne: null, $ne: "" }, ...(ownerFilterValue ? { owner: ownerFilterValue.trim() } : {}) } },
            { $group: {
                _id: "$items.productId", // The productId string
                relatedBills: {
                    $push: {
                        billId: "$_id", invoiceId: "$invoiceId", invoiceType: "$invoiceType",
                        invoiceDate: "$invoiceDate", dueDate: "$dueDate", totalAmount: "$totalAmount"
                    }
                }
            }}
        ]).toArray();

        const billDetailsMap = new Map();
        billDetailsPerProduct.forEach(item => {
            const billsWithStrIds = item.relatedBills.map(billDetail => ({
                ...billDetail, billId: billDetail.billId.toString()
            }));
            billDetailsMap.set(item._id, billsWithStrIds); // key is already string from $group _id
        });

        // 2. Aggregate Total Inventory Stock (Existing Logic - Filter applied later when combining)
        // Fetch all inventory first, then filter based on the products retrieved
        const allInventoryStock = await inventoryCollection.aggregate([
             {
                 $match: { productId: { $exists: true, $ne: null } } // Ensure productId exists
             },
             {
                 $group: {
                     _id: "$productId", // Group by the ObjectId of the product
                     totalStock: { $sum: "$quantity" } // Sum the quantity for each product
                 }
             }
         ]).toArray();
        const inventoryStockMap = new Map();
        allInventoryStock.forEach(item => {
            inventoryStockMap.set(item._id.toString(), item.totalStock);
        });


        // 3. Fetch Products based on Owner Filter
        const products = await productsCollection.find(productFilter).toArray(); // Apply the owner filter here

        // 4. Combine Product Data with Bill Details and Total Stock
        const productsWithDetails = products.map(product => {
            const productIdString = product._id.toString();
            // Bill details map already created (may contain bills for products not matching the owner filter, which is fine)
            const relatedBillList = billDetailsMap.get(productIdString) || [];
            // Inventory map already created, get stock for the filtered products
            const totalStock = inventoryStockMap.get(productIdString) || 0;

            return {
                ...product,
                relatedBills: relatedBillList,
                totalStock: totalStock // Add totalStock field
            };
        });

        res.status(200).json({ success: true, data: productsWithDetails });
    } catch (error) {
        console.error('Error fetching products with details and stock:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});


// GET /products/:id (Single) - Reverted to fetch raw product data
router.get('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const productsCollection = db.collection('products');
        const attributesCollection = db.collection('product_attributes'); // Added for term lookup
        const inventoryCollection = db.collection('inventorys'); // Added for stock lookup
        const productId = safeObjectId(req.params.id);
        if (!productId) return res.status(400).json({ error: 'Invalid Product ID format.' });

        // Fetch the product directly
        const product = await productsCollection.findOne({ _id: productId });

        if (!product) {
            return res.status(404).json({ error: 'Product not found.' });
        }

        // --- Populate Variation Attributes with Term Details & Get Stock ---
        if (product.inventoryType === 'variation' && product.variations && product.variations.length > 0) {

            // --- Aggregate Stock per SKU ---
            let stockMap = new Map();
            try {
                const stockAggregation = await inventoryCollection.aggregate([
                    { $match: { productId: productId } }, // Filter by product ID
                    { $unwind: "$variations" },           // Deconstruct the variations array in inventory
                    {
                        $group: {                         // Group by SKU
                            _id: "$variations.sku",
                            totalStock: { $sum: "$variations.quantity" } // Sum quantities for each SKU
                        }
                    }
                ]).toArray();

                // Create a map for quick lookup: sku -> totalStock
                stockAggregation.forEach(item => {
                    stockMap.set(item._id, item.totalStock);
                });
                 console.log(`[LOG] GET /products/:id - Aggregated stock for ${productId}:`, stockMap);
            } catch (aggError) {
                 console.error(`Error aggregating stock for product ${productId}:`, aggError);
                 // Continue without stock info if aggregation fails, or return error?
                 // For now, we'll proceed and stock will be missing/0.
            }
            // --- End Stock Aggregation ---


            // --- Populate Terms (Existing Logic) ---
            const allAttributeIds = new Set();
            product.variations.forEach(variation => {
                variation.attributes?.forEach(attr => {
                    if (attr.attributeId) {
                        const attrIdObj = safeObjectId(attr.attributeId);
                        if(attrIdObj) allAttributeIds.add(attrIdObj);
                    }
                });
            });

            let attributeMap = new Map();
            if (allAttributeIds.size > 0) {
                const attributeDocs = await attributesCollection.find({ _id: { $in: Array.from(allAttributeIds) } }).toArray();
                attributeDocs.forEach(doc => attributeMap.set(doc._id.toString(), doc));
            }
            // --- End Term Population Prep ---


            // --- Enrich Variations with Terms and Stock ---
            product.variations = product.variations.map(variation => {
                // Populate Attributes with Terms
                const populatedAttributes = variation.attributes?.map(attr => {
                    const attrIdStr = attr.attributeId?.toString();
                    const termCode = attr.termCode;
                    const attributeDoc = attributeMap.get(attrIdStr);

                    if (attributeDoc && termCode) {
                        const termData = attributeDoc.terms?.find(t => t.code === termCode);
                        if (termData) {
                            return {
                                attributeId: attr.attributeId,
                                attributeName: attributeDoc.name,
                                attributeMode: attributeDoc.mode,
                                termCode: termCode,
                                termName: termData.name,
                                termValue: termData.value
                            };
                        }
                    }
                    return attr; // Fallback
                }).filter(Boolean);

                // Get Total Stock for this Variation's SKU
                const totalStock = stockMap.get(variation.sku) || 0; // Default to 0 if not found

                // Return the enriched variation object
                return {
                    ...variation,
                    attributes: populatedAttributes || [],
                    totalStock: totalStock // Add the total stock field
                };
            });
            // --- End Enrich Variations ---
        }
        // --- End Population & Stock ---

        res.status(200).json({ success: true, data: product });
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({ error: 'Failed to fetch product' });
    }
});

// PUT /products/:id (Update main product data) - Modified for SKU and Barcode checks
router.put('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const productsCollection = db.collection('products');
        const productId = safeObjectId(req.params.id);
        if (!productId) return res.status(400).json({ error: 'Invalid Product ID format.' });

        const { sku, barcode, ...updatedProductData } = req.body; // Separate SKU and Barcode
        delete updatedProductData._id;
        delete updatedProductData.createdAt;
        // IMPORTANT: Prevent direct overwrite of attributes array via this endpoint
        delete updatedProductData.attributes;

        // --- SKU Uniqueness Check (if SKU is being updated) ---
        if (sku !== undefined && sku !== null) { // Check if SKU is part of the update payload
            const trimmedSku = String(sku).trim();
            if (trimmedSku !== '') {
                // Check if this SKU exists for *another* product
                const existingSkuProduct = await productsCollection.findOne({
                    sku: trimmedSku,
                    _id: { $ne: productId } // Exclude the current product being updated
                });
                if (existingSkuProduct) {
                    return res.status(400).json({ error: `SKU "${trimmedSku}" already exists for another product.` });
                }
                updatedProductData.sku = trimmedSku; // Add validated SKU to the update set
            } else {
                // If SKU is sent as an empty string, allow setting it (or handle as needed)
                 updatedProductData.sku = ''; // Or null, depending on schema requirements
            }
        } else if (sku === null) {
             // Allow explicitly setting SKU to null if needed
             updatedProductData.sku = null;
        }
        // If sku is not present in req.body, it won't be checked or updated.
        // --- End SKU Check ---

        // --- Barcode Uniqueness Check (if Barcode is being updated) ---
         if (barcode !== undefined && barcode !== null) { // Check if Barcode is part of the update payload
            const trimmedBarcode = String(barcode).trim();
            if (trimmedBarcode !== '') {
                // Check if this Barcode exists for *another* product
                const existingBarcodeProduct = await productsCollection.findOne({
                    barcode: trimmedBarcode,
                    _id: { $ne: productId } // Exclude the current product being updated
                });
                if (existingBarcodeProduct) {
                    return res.status(400).json({ error: `Barcode "${trimmedBarcode}" already exists for another product.` });
                }
                updatedProductData.barcode = trimmedBarcode; // Add validated Barcode to the update set
            } else {
                // If Barcode is sent as an empty string, allow setting it
                 updatedProductData.barcode = ''; // Or null, depending on schema requirements
            }
        } else if (barcode === null) {
             // Allow explicitly setting Barcode to null if needed
             updatedProductData.barcode = null;
        }
        // If barcode is not present in req.body, it won't be checked or updated.
        // --- End Barcode Check ---

        // Check if there are any fields left to update after removing system fields and attributes
        if (Object.keys(updatedProductData).length === 0) {
             // If only sku/barcode were provided but didn't need changing, or only attributes were sent
             const currentDoc = await productsCollection.findOne({ _id: productId });
             if (!currentDoc) return res.status(404).json({ error: 'Product not found' });
             // Nothing to update in the main fields, return current data
             console.log("PUT /products/:id - No standard fields to update.");
             return res.status(200).json({ success: true, data: currentDoc, message: "No standard fields needed update." });
        }


        const result = await productsCollection.updateOne(
            { _id: productId },
            { $set: updatedProductData, $currentDate: { lastModified: true } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        const updatedDoc = await productsCollection.findOne({ _id: productId });
        res.status(200).json({ success: true, data: updatedDoc });
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ error: 'Failed to update product' });
    }
});


// DELETE /products/:id (Delete Product)
// ... (existing code with inventory check) ...
router.delete('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const productsCollection = db.collection('products');
        const productId = safeObjectId(req.params.id);
        // Check if product is in use in bills
        const billsCollection = db.collection('bills');
        const relatedBill = await billsCollection.findOne({ "items.productId": req.params.id }); // Check using string ID
        if (relatedBill) {
            return res.status(400).json({ error: 'Cannot delete product: It is currently used in one or more bills.' });
        }
        // Check if product is in use in inventorys
        const inventoryCollection = db.collection('inventorys');
        const relatedInventory = await inventoryCollection.findOne({"productId": productId });
         if (relatedInventory) {
            return res.status(400).json({ error: 'Cannot delete product: It has existing inventory records.' });
        }


        const result = await productsCollection.deleteOne({ _id: productId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.status(200).json({ success: true, data: { deletedCount: result.deletedCount } });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});


// --- Product Attributes Assignment Endpoint ---

// PUT /products/:productId/attributes - Set/Replace all attributes for a product
router.put('/:productId/attributes', async (req, res) => {
     try {
        const db = req.client.db('dss');
        const productsCollection = db.collection('products');
        const attributesCollection = db.collection('product_attributes'); // Need to validate attributeId
        const productId = safeObjectId(req.params.productId);

        if (!productId) {
            return res.status(400).json({ error: 'Invalid Product ID.' });
        }

        const attributes = req.body; // Expecting an array: [{ attributeId: "...", value: "..." }, ...]

        if (!Array.isArray(attributes)) {
             return res.status(400).json({ error: 'Request body must be an array of attributes.' });
        }

        // Validate and prepare attributes array
        const processedAttributes = [];
        const attributeIds = []; // To check for duplicates

        for (const attr of attributes) {
            const attributeId = safeObjectId(attr.attributeId);
            const value = attr.value;
            if (!attributeId || value === undefined || typeof value !== 'string' || value.trim() === '') {
                return res.status(400).json({ error: `Invalid attribute format: attributeId and non-empty string value required. Problem: ${JSON.stringify(attr)}` });
            }
             // Check if attributeId exists in master collection
            const masterAttr = await attributesCollection.findOne({_id: attributeId});
            if (!masterAttr) {
                return res.status(400).json({ error: `Invalid attributeId "${attr.attributeId}" provided. It does not exist.`});
            }
            // Check for duplicates within the request
            if (attributeIds.includes(attributeId.toString())) {
                 return res.status(400).json({ error: `Duplicate attribute type "${masterAttr.name || attr.attributeId}" assigned in the request.` });
            }
            attributeIds.push(attributeId.toString());
            processedAttributes.push({ attributeId: attributeId, value: value.trim() });
        }

        // Update the product by replacing the entire attributes array
        const result = await productsCollection.updateOne(
            { _id: productId },
            {
                $set: { attributes: processedAttributes }, // Overwrite the array
                $currentDate: { lastModified: true }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Product not found.' });
        }

        // Fetch the updated product to return
        const updatedProduct = await productsCollection.findOne({ _id: productId });
        res.status(200).json({ success: true, data: updatedProduct });

    } catch (error) {
        console.error('Error setting product attributes:', error);
        res.status(500).json({ error: 'Failed to set product attributes.' });
    }
});


// DELETE /products/:productId/attributes/:attributeName <<< REMOVED
// PUT /products/:productId/attributes/:attributeName    <<< REMOVED
// POST /products/:productId/attributes                 <<< REMOVED

// --- Product Inventory Endpoint ---

// GET /products/:productId/inventory - Get all inventory records for a specific product (including variations)
router.get('/:productId/inventory', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const inventoryCollection = db.collection('inventorys');
        const productsCollection = db.collection('products'); // To check if product exists

        const productId = safeObjectId(req.params.productId);
        if (!productId) {
            return res.status(400).json({ error: 'Invalid Product ID format.' });
        }

        // Optional: Check if product actually exists first
        const productExists = await productsCollection.countDocuments({ _id: productId });
        if (productExists === 0) {
             return res.status(404).json({ error: 'Product not found.' });
        }


        // Fetch all inventory records for this product, populating location names and including variations
        const inventoryLevels = await inventoryCollection.aggregate([
            // Filter by the specific product ID
            { $match: { productId: productId } },
            // Join with locations collection
            {
                $lookup: {
                    from: 'locations',
                    localField: 'locationId',
                    foreignField: '_id',
                    as: 'locationDetails'
                }
            },
            // Deconstruct the locationDetails array
            {
                 $unwind: { path: "$locationDetails", preserveNullAndEmptyArrays: true } // Keep record even if location deleted
            },
            // Select and reshape the output for inventory levels
            {
                $project: {
                    _id: 1, // Inventory record ID
                    locationId: 1,
                    quantity: 1, // Total quantity for this location
                    variations: 1, // <<< ADDED: Include the variations array
                    locationName: { $ifNull: ["$locationDetails.name", "N/A"] }, // Handle deleted locations
                    updatedAt: 1,
                    createdAt: 1 // <<< ADDED: Optionally include createdAt
                }
            },
            { $sort: { locationName: 1 } } // Sort by location name
        ]).toArray();

        // inventoryLevels will be an empty array [] if the product exists but has no inventory records, which is correct.

        res.status(200).json({ success: true, data: inventoryLevels });

    } catch (error) {
        console.error('Error fetching inventory for product:', error);
        res.status(500).json({ error: 'Failed to fetch product inventory' });
    }
});

// --- Update/Set Product Stock at a Specific Location ---

// PUT /products/:productId/stocks - Set/Update stock for a product at a specific location
router.put('/:productId/stocks', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const inventoryCollection = db.collection('inventorys');
        const movementsCollection = db.collection('stock_movements');
        const productsCollection = db.collection('products');
        const locationsCollection = db.collection('locations');

        const productId = safeObjectId(req.params.productId);
        const { locationId, newQuantity, reason, notes } = req.body;
        const userId = req.user?._id; // Optional: Get user ID

        // --- Validation ---
        const locationIdObj = safeObjectId(locationId);

        if (!productId) {
            return res.status(400).json({ error: 'Invalid Product ID format.' });
        }
        if (!locationIdObj) {
            return res.status(400).json({ error: 'Valid locationId is required in the request body.' });
        }
        if (newQuantity == null || typeof newQuantity !== 'number' || !Number.isInteger(newQuantity) || newQuantity < 0) {
            return res.status(400).json({ error: 'newQuantity is required in the request body and must be a non-negative integer.' });
        }
        if (!reason || typeof reason !== 'string' || reason.trim() === '') {
            return res.status(400).json({ error: 'Reason code is required in the request body.' });
        }

        // --- Check Existence of Product and Location ---
        const productExists = await productsCollection.countDocuments({ _id: productId });
        if (productExists === 0) {
             return res.status(404).json({ error: 'Product not found.' });
        }
        const locationExists = await locationsCollection.countDocuments({ _id: locationIdObj });
         if (locationExists === 0) {
             return res.status(404).json({ error: 'Location not found.' });
        }

        // --- Find or Create Inventory Record ---
        let inventoryRecord = await inventoryCollection.findOne(
            { productId: productId, locationId: locationIdObj }
        );

        let currentQuantity = 0;
        let inventoryIdObj = null;
        let isNewInventory = false;

        if (!inventoryRecord) {
            // Inventory doesn't exist for this product/location, create it first with quantity 0
            console.log(`Inventory not found for Product ${productId} at Location ${locationId}. Creating...`);
            const newInventory = {
                productId: productId,
                locationId: locationIdObj,
                quantity: 0, // Start at 0 before applying the 'update'
                createdAt: new Date(),
                updatedAt: new Date()
            };
            const insertResult = await inventoryCollection.insertOne(newInventory);
            inventoryIdObj = insertResult.insertedId;
            inventoryRecord = { ...newInventory, _id: inventoryIdObj }; // Use the newly created record
            currentQuantity = 0;
            isNewInventory = true;
        } else {
            // Inventory exists
            inventoryIdObj = inventoryRecord._id;
            currentQuantity = inventoryRecord.quantity;
        }

        // --- Calculate Change and Log Movement ---
        const quantityChange = newQuantity - currentQuantity;

        const movementType = isNewInventory ? 'INITIAL_SET' : 'ADJUSTMENT'; // Or just use 'ADJUSTMENT' always

        const newMovement = {
            productId: productId,
            locationId: locationIdObj,
            inventoryId: inventoryIdObj,
            type: movementType, // Use a type indicating this was a direct set/update via product endpoint
            quantityChange: quantityChange,
            quantityAfter: newQuantity,
            reason: reason.trim(),
            notes: notes || null,
            timestamp: new Date(),
            userId: userId || null
        };
        const movementResult = await movementsCollection.insertOne(newMovement);
        const createdMovementId = movementResult.insertedId;

        // --- Update Inventory Quantity ---
        const updateResult = await inventoryCollection.updateOne(
            { _id: inventoryIdObj },
            { $set: { quantity: newQuantity, updatedAt: new Date() } }
        );

         // Optional: Check updateResult.modifiedCount or updateResult.matchedCount

        // --- Response ---
        // Fetch the final state of the inventory record to return
        const finalInventoryRecord = await inventoryCollection.findOne({_id: inventoryIdObj});
        res.status(200).json({
            success: true,
            message: `Stock for product ${req.params.productId} at location ${locationId} ${isNewInventory ? 'initialized' : 'updated'} successfully.`,
            data: {
                 inventory: finalInventoryRecord, // Return the updated/created inventory record
                 movementId: createdMovementId.toString()
            }
         });

    } catch (error) {
        console.error('Error updating/setting product stock:', error);
        res.status(500).json({ error: 'Failed to update product stock' });
    }
});

// POST /products/:productId/stocks - Add, Remove, or Adjust stock based on Type
router.post('/:productId/stocks', async (req, res) => {
    let createdMovementId = null; // For potential rollback
    const db = req.client.db('dss');
    const inventoryCollection = db.collection('inventorys');
    const movementsCollection = db.collection('stock_movements');
    const ownerFromHeader = req.headers.owner; // Get owner from header

    try {
        const productsCollection = db.collection('products');
        const locationsCollection = db.collection('locations');

        const productId = safeObjectId(req.params.productId);
        // Expect type, quantityChange, reason, locationId, notes, variationSku (optional)
        const { locationId, variationSku, type, quantityChange, reason, notes } = req.body;
        const userId = req.user?._id;

        // --- Basic Validation ---
        const locationIdObj = safeObjectId(locationId);
        if (!productId) return res.status(400).json({ error: 'Invalid Product ID format.' });
        if (!locationIdObj) return res.status(400).json({ error: 'Valid locationId is required.' });

        // Validate Type
        const typeTrimmed = type?.trim().toUpperCase();
        const validTypes = ['ADD', 'REMOVE', 'ADJUSTMENT'];
        if (!typeTrimmed || !validTypes.includes(typeTrimmed)) {
            return res.status(400).json({ error: `Invalid or missing type. Must be one of: ${validTypes.join(', ')}.` });
        }

        // Validate quantityValue based on type
        if (quantityChange == null || typeof quantityChange !== 'number' || !Number.isInteger(quantityChange) || quantityChange < 0) {
            // All types require a non-negative integer value
            return res.status(400).json({ error: 'quantityChange field is required and must be a non-negative integer.' + quantityChange });
        }

        // Validate Reason
        const reasonTrimmed = reason?.trim(); // Keep original case for logging
        if (!reasonTrimmed || reasonTrimmed === '') {
            return res.status(400).json({ error: 'Reason description is required.' });
        }

        // --- Check Existence of Product and Location, AND Get Product Type ---
        const product = await productsCollection.findOne({ _id: productId });
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        const locationExists = await locationsCollection.countDocuments({ _id: locationIdObj });
         if (locationExists === 0) return res.status(404).json({ error: 'Location not found.' });

        // Check Product Owner
        if (ownerFromHeader && product.owner !== ownerFromHeader) {
             return res.status(403).json({ error: `Permission denied: Product ${productId} does not belong to the specified owner.` });
        }

        // Check Location Owner
        const location = await locationsCollection.findOne({ _id: locationIdObj });
        if (!location) return res.status(404).json({ error: 'Location not found.' });
        if (ownerFromHeader && location.owner !== ownerFromHeader) {
             return res.status(403).json({ error: `Permission denied: Location ${locationId} does not belong to the specified owner.` });
        }

        // --- CONDITIONAL Validation for variationSku based on inventoryType ---
        const isSimpleProduct = product.inventoryType === 'simple';
        let trimmedVariationSku = null;
        if (!isSimpleProduct) {
            if (!variationSku || typeof variationSku !== 'string' || variationSku.trim() === '') {
                return res.status(400).json({ error: 'variationSku is required for non-simple products.' });
            }
            trimmedVariationSku = variationSku.trim();
        } else if (variationSku !== undefined && variationSku !== null && variationSku.trim() !== '') {
             console.warn(`Non-empty variationSku ('${variationSku}') provided for simple product ${productId}, it will be ignored.`);
        }

        // --- Find or Create MAIN Inventory Record & Check Ownership ---
        let inventoryRecord = await inventoryCollection.findOne({ productId: productId, locationId: locationIdObj });
        let inventoryIdObj = null;
        let isNewInventory = false;

        if (!inventoryRecord) {
             console.log(`Main inventory not found for Product ${productId} at Location ${locationId}. Creating...`);
             const newInventory = {
                 productId: productId,
                 locationId: locationIdObj,
                 quantity: 0,
                 variations: [],
                 createdAt: new Date(),
                 updatedAt: new Date()
                 // Add owner when creating
             };
             if (ownerFromHeader) {
                 newInventory.owner = ownerFromHeader;
             }
             const insertResult = await inventoryCollection.insertOne(newInventory);
             inventoryIdObj = insertResult.insertedId;
             inventoryRecord = { ...newInventory, _id: inventoryIdObj };
             isNewInventory = true;
        } else {
             inventoryIdObj = inventoryRecord._id;
             // Check existing inventory owner
             if (ownerFromHeader && inventoryRecord.owner !== ownerFromHeader) {
                  return res.status(403).json({ error: `Permission denied: Existing inventory record at location ${locationId} does not belong to the specified owner.` });
             }
        }

        // --- Initialize Calculation Variables ---
        let currentTotalQuantity = inventoryRecord.quantity;
        let currentVariationQuantity = 0; // For variable product
        let finalTotalQuantity;
        let finalVariationQuantity = 0; // For variable product
        let actualQuantityChangeForLog; // The actual change amount to log
        let updateOperation = {}; // To build the MongoDB update query
        let existingVariation = null; // For variable product

        // --- Logic for Simple Product ---
        if (isSimpleProduct) {
            switch (typeTrimmed) {
                case 'ADD':
                    actualQuantityChangeForLog = quantityChange;
                    finalTotalQuantity = currentTotalQuantity + actualQuantityChangeForLog;
                    updateOperation = { $inc: { quantity: actualQuantityChangeForLog }, $set: { updatedAt: new Date() } };
                    break;
                case 'REMOVE':
                    actualQuantityChangeForLog = -quantityChange; // Change is negative
                    finalTotalQuantity = currentTotalQuantity + actualQuantityChangeForLog;
                    if (finalTotalQuantity < 0) {
                         return res.status(400).json({ error: `Removal results in negative stock (${finalTotalQuantity}) for simple product. Current: ${currentTotalQuantity}, Trying to remove: ${quantityChange}` });
                    }
                    updateOperation = { $inc: { quantity: actualQuantityChangeForLog }, $set: { updatedAt: new Date() } };
                    break;
                case 'ADJUSTMENT':
                    finalTotalQuantity = quantityChange; // Input value is the final quantity
                    actualQuantityChangeForLog = finalTotalQuantity - currentTotalQuantity;
                    updateOperation = { $set: { quantity: finalTotalQuantity, updatedAt: new Date() } };
                    break;
            }

            // Log Movement for Simple Product
            const newMovement = {
                productId: productId, locationId: locationIdObj, inventoryId: inventoryIdObj,
                variationSku: null,
                type: typeTrimmed,
                quantityChange: actualQuantityChangeForLog,
                quantityAfter: finalTotalQuantity,
                reason: reasonTrimmed,
                notes: notes || null, timestamp: new Date(), userId: userId || null
            };
            // Add owner to movement
            if (ownerFromHeader) {
                 newMovement.owner = ownerFromHeader;
            }
            console.log(`[LOG] Attempting to insert movement (simple, type=${typeTrimmed}):`, newMovement);
            movementResult = await movementsCollection.insertOne(newMovement);
            createdMovementId = movementResult.insertedId;

            // Perform Update for Simple Product
            console.log(`[LOG] Attempting to update inventory ${inventoryIdObj} (simple) using:`, updateOperation);
            updateResult = await inventoryCollection.updateOne({ _id: inventoryIdObj }, updateOperation);

        // --- Logic for Variable Product ---
        } else {
            existingVariation = inventoryRecord.variations?.find(v => v.sku === trimmedVariationSku);
            currentVariationQuantity = existingVariation ? existingVariation.quantity : 0;

            switch (typeTrimmed) {
                case 'ADD':
                    actualQuantityChangeForLog = quantityChange; // Change for this variation
                    finalVariationQuantity = currentVariationQuantity + actualQuantityChangeForLog;
                    finalTotalQuantity = currentTotalQuantity + actualQuantityChangeForLog; // Total also increases

                    if (existingVariation) {
                        updateOperation = {
                            $inc: { quantity: actualQuantityChangeForLog }, // Increment total
                            $set: { "variations.$.quantity": finalVariationQuantity, updatedAt: new Date() }
                        };
                    } else {
                        updateOperation = {
                            $inc: { quantity: actualQuantityChangeForLog }, // Increment total
                            $push: { variations: { sku: trimmedVariationSku, quantity: finalVariationQuantity } },
                            $set: { updatedAt: new Date() }
                        };
                    }
                    break;
                case 'REMOVE':
                    actualQuantityChangeForLog = -quantityChange; // Change for this variation is negative
                    finalVariationQuantity = currentVariationQuantity + actualQuantityChangeForLog;
                     if (finalVariationQuantity < 0) {
                         return res.status(400).json({ error: `Removal results in negative stock (${finalVariationQuantity}) for variation ${trimmedVariationSku}. Current: ${currentVariationQuantity}, Trying to remove: ${quantityChange}` });
                     }
                    finalTotalQuantity = currentTotalQuantity + actualQuantityChangeForLog; // Total also decreases

                    if (existingVariation) {
                         updateOperation = {
                             $inc: { quantity: actualQuantityChangeForLog }, // Increment total (negative value)
                             $set: { "variations.$.quantity": finalVariationQuantity, updatedAt: new Date() }
                         };
                    } else {
                         // Cannot remove stock from a variation that doesn't exist
                         return res.status(400).json({ error: `Cannot remove stock for variation SKU "${trimmedVariationSku}" as it does not exist in inventory for product ${productId} at location ${locationId}.` });
                    }
                    break;
                case 'ADJUSTMENT':
                    finalVariationQuantity = quantityChange; // Input value is the final quantity for this variation
                    actualQuantityChangeForLog = finalVariationQuantity - currentVariationQuantity; // Change for this variation
                    finalTotalQuantity = currentTotalQuantity + actualQuantityChangeForLog; // Adjust total accordingly

                    if (existingVariation) {
                         updateOperation = {
                             // Use $set for the variation and $inc for the total quantity change
                             $inc: { quantity: actualQuantityChangeForLog },
                             $set: { "variations.$.quantity": finalVariationQuantity, updatedAt: new Date() }
                         };
                    } else {
                         // Setting a quantity for a new variation
                         updateOperation = {
                             $inc: { quantity: actualQuantityChangeForLog }, // Increment total by the full amount being set
                             $push: { variations: { sku: trimmedVariationSku, quantity: finalVariationQuantity } },
                             $set: { updatedAt: new Date() }
                         };
                    }
                    break;
            }

            // Log Movement for Variable Product
            const newMovement = {
                productId: productId, locationId: locationIdObj, inventoryId: inventoryIdObj,
                variationSku: trimmedVariationSku,
                type: typeTrimmed,
                quantityChange: actualQuantityChangeForLog,
                quantityAfter: finalVariationQuantity,
                reason: reasonTrimmed,
                notes: notes || null, timestamp: new Date(), userId: userId || null
            };
             // Add owner to movement
            if (ownerFromHeader) {
                 newMovement.owner = ownerFromHeader;
            }
            console.log(`[LOG] Attempting to insert movement (variable, type=${typeTrimmed}):`, newMovement);
            movementResult = await movementsCollection.insertOne(newMovement);
            createdMovementId = movementResult.insertedId;

            // Perform Update for Variable Product
            let filter = { _id: inventoryIdObj };
             // Add SKU filter only when updating/removing an existing variation
            if (existingVariation && (typeTrimmed === 'REMOVE' || typeTrimmed === 'ADJUSTMENT' || typeTrimmed === 'ADD')) {
                 filter["variations.sku"] = trimmedVariationSku;
            }
            console.log(`[LOG] Attempting to update inventory ${inventoryIdObj} (variable) using filter:`, filter, `and update:`, updateOperation);
            updateResult = await inventoryCollection.updateOne(filter, updateOperation);
        }

        // --- Rollback Check (Common logic, adjusted slightly) ---
        if (updateResult.matchedCount === 0 && !(isSimpleProduct && isNewInventory)) {
            // If matchedCount is 0, it's an error unless it was the very first operation creating a simple product record
            // Let's refine the check for variable product push failure
             if (!isSimpleProduct && !existingVariation && (typeTrimmed === 'ADD' || typeTrimmed === 'ADJUSTMENT') && updateResult.modifiedCount === 0) {
                  // We were trying to push a new variation but nothing got modified
                  console.error(`Inventory record ${inventoryIdObj} matched, but PUSH operation failed for new variation ${trimmedVariationSku}! Rolling back movement ${createdMovementId}.`);
                  await movementsCollection.deleteOne({_id: createdMovementId});
                  throw new Error(`Inventory PUSH failed for new variation ${trimmedVariationSku} on product ${productId}`);
             } else if (updateResult.matchedCount === 0) {
                 // General case: record wasn't found when it should have been
                 console.error(`Inventory record ${inventoryIdObj} match failed during update (matchedCount=0)! Rolling back movement ${createdMovementId}. isSimple=${isSimpleProduct}, existingVariation=${!!existingVariation}, type=${typeTrimmed}`);
                 await movementsCollection.deleteOne({_id: createdMovementId});
                 throw new Error(`Inventory update failed (match count 0) for product ${productId}`);
             }
        }
        // Optional: Warning if modifiedCount is 0 when a change was expected
        if (updateResult.modifiedCount === 0 && actualQuantityChangeForLog !== 0) {
             console.warn(`Inventory update for ${inventoryIdObj} resulted in no modification (modifiedCount=0), despite expected change ${actualQuantityChangeForLog} (type=${typeTrimmed}). Check operation logic and filters.`);
         }

        // --- Response ---
        const finalInventoryRecord = await inventoryCollection.findOne({_id: inventoryIdObj});
        res.status(200).json({
            success: true,
            message: `Stock operation '${typeTrimmed}' for product ${req.params.productId}${isSimpleProduct ? '' : `, variation ${trimmedVariationSku}`} at location ${locationId} completed successfully. Reason: '${reasonTrimmed}'.`,
            data: {
                 inventory: finalInventoryRecord,
                 movementId: createdMovementId ? createdMovementId.toString() : null
            }
         });

    } catch (error) {
        console.error('--- Detailed Error Processing Product Stock Operation via POST ---');
        // ... (keep detailed error logging) ...
        console.error('Timestamp:', new Date().toISOString());
        console.error('Product ID:', req.params.productId);
        console.error('Request Body:', req.body);
        console.error('User ID:', req.user?._id || 'N/A');
        console.error('Error Name:', error.name);
        console.error('Error Message:', error.message);
        if (error.code) { console.error('MongoDB Error Code:', error.code); }
        console.error('Stack Trace:', error.stack);
        console.error('---------------------------------------------');

        // Attempt rollback
        if (createdMovementId && movementsCollection) {
             try {
                 console.warn(`Attempting rollback of movement ${createdMovementId} due to caught error.`);
                 await movementsCollection.deleteOne({ _id: createdMovementId });
             } catch (rollbackError) {
                 console.error(`Failed to rollback movement ${createdMovementId}:`, rollbackError);
             }
        }
        res.status(500).json({ error: 'Failed to process product stock operation. Please check server logs for details.' });
    }
});

// --- Get Product Stock by Specific SKU ---
// GET /products/:id/stock/:sku
router.get('/:id/stock/:sku', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const inventoryCollection = db.collection('inventorys');
        const productsCollection = db.collection('products');
        const locationsCollection = db.collection('locations');

        const productId = safeObjectId(req.params.id);
        const specificSku = req.params.sku?.trim();

        if (!productId) {
            return res.status(400).json({ error: 'Invalid Product ID format.' });
        }
        if (!specificSku) {
            return res.status(400).json({ error: 'SKU parameter is required in the URL path.' });
        }

        // 1. Check if product exists and get its type
        const product = await productsCollection.findOne({ _id: productId }, { projection: { inventoryType: 1, sku: 1 } });
        if (!product) {
            return res.status(404).json({ error: 'Product not found.' });
        }

        // 2. Fetch base inventory levels with location details
        const baseInventoryLevels = await inventoryCollection.aggregate([
            { $match: { productId: productId } },
            {
                $lookup: {
                    from: 'locations',
                    localField: 'locationId',
                    foreignField: '_id',
                    as: 'locationDetails'
                }
            },
            {
                $unwind: { path: "$locationDetails", preserveNullAndEmptyArrays: true }
            },
            {
                $project: {
                    _id: 0,
                    inventoryId: "$_id",
                    locationId: 1,
                    locationName: { $ifNull: ["$locationDetails.name", "N/A"] },
                    totalQuantity: "$quantity",
                    variations: 1,
                    updatedAt: 1,
                    createdAt: 1
                }
            },
            { $sort: { locationName: 1 } }
        ]).toArray();

        // 3. Process based on product type and specific SKU
        let finalStockData = [];

        if (product.inventoryType === 'simple') {
            // For simple products, check if the provided SKU matches the product's main SKU
            if (product.sku === specificSku) {
                finalStockData = baseInventoryLevels.map(inv => ({
                    locationId: inv.locationId,
                    locationName: inv.locationName,
                    sku: product.sku,
                    quantity: inv.totalQuantity,
                    isSimpleProduct: true,
                    updatedAt: inv.updatedAt,
                    createdAt: inv.createdAt
                }));
                console.log(`[LOG] GET /stock/:sku: Simple product ${productId}, SKU ${specificSku} matches. Returning total stock per location.`);
            } else {
                console.log(`[LOG] GET /stock/:sku: Simple product ${productId}, requested SKU ${specificSku} does not match product SKU ${product.sku}. Returning empty.`);
                // Return empty array as the specific SKU doesn't match the simple product's SKU
            }

        } else { // Variable product
            finalStockData = baseInventoryLevels.map(inv => {
                const variationData = inv.variations?.find(v => v.sku === specificSku);
                if (variationData) {
                    return {
                        locationId: inv.locationId,
                        locationName: inv.locationName,
                        sku: specificSku,
                        quantity: variationData.quantity,
                        updatedAt: inv.updatedAt,
                        createdAt: inv.createdAt
                    };
                }
                return null;
            }).filter(Boolean); // Filter out locations where the specific SKU wasn't found
            console.log(`[LOG] GET /stock/:sku: Variable product ${productId}, filtering for SKU: ${specificSku}`);
        }

        res.status(200).json({ success: true, data: finalStockData });

    } catch (error) {
        console.error(`Error fetching stock for product ${req.params.id}, SKU ${req.params.sku}:`, error);
        res.status(500).json({ error: 'Failed to fetch product stock' });
    }
});

// --- Check Slug Availability ---
// POST /dss/products/check-slug
router.post('/check-slug', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const productsCollection = db.collection('products');

        const { slug, productId } = req.body;

        // --- Validation ---
        if (!slug || typeof slug !== 'string' || slug.trim() === '') {
            return res.status(400).json({ error: 'Slug is required.' });
        }
        const trimmedSlug = slug.trim();
        let productIdObj = null;
        if (productId) {
            productIdObj = safeObjectId(productId);
            if (!productIdObj) {
                // Optional: Return error or just ignore invalid productId
                 console.warn(`Invalid optional productId format received: ${productId}. Proceeding check without exclusion.`);
                // return res.status(400).json({ error: 'Invalid optional productId format.' });
            }
        }

        // --- Build Query ---
        const filter = {
            slug: trimmedSlug
        };

        // If a valid productId was provided, exclude it from the check
        if (productIdObj) {
            filter._id = { $ne: productIdObj }; // Find slugs that are NOT this productId
        }

        console.log(`[LOG] Checking slug availability with filter:`, filter);

        // --- Check Database ---
        // Use countDocuments for efficiency as we only need to know if it exists (count > 0)
        const count = await productsCollection.countDocuments(filter);

        // --- Determine Availability ---
        const isAvailable = count === 0; // Slug is available if no *other* product uses it

        console.log(`[LOG] Slug '${trimmedSlug}' check result (excluding ID ${productIdObj}): count=${count}, isAvailable=${isAvailable}`);

        // --- Response ---
        res.status(200).json({ success: true, isAvailable: isAvailable });

    } catch (error) {
        console.error('--- Error Checking Slug Availability ---');
        console.error('Timestamp:', new Date().toISOString());
        console.error('Request Body:', req.body);
        console.error('Error Name:', error.name);
        console.error('Error Message:', error.message);
        if (error.code) { console.error('MongoDB Error Code:', error.code); }
        console.error('Stack Trace:', error.stack);
        console.error('--------------------------------------');
        res.status(500).json({ success: false, error: 'Failed to check slug availability. Please check server logs.' });
    }
});

// --- Add Image to Product's otherMedia (Context: Variation Image Upload) ---
// PATCH /dss/products/:productId/variations/:variationSku/image
router.patch('/:productId/variations/:variationSku/image', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const productsCollection = db.collection('products');

        const productId = safeObjectId(req.params.productId);
        const variationSku = req.params.variationSku; // Keep for context/validation
        const { imageUrl } = req.body;

        // --- Validation ---
        if (!productId) {
            return res.status(400).json({ error: 'Invalid Product ID format.' });
        }
        if (!variationSku || typeof variationSku !== 'string' || variationSku.trim() === '') {
            // Even though we add to otherMedia, the context is a variation image upload, so SKU is still relevant
            return res.status(400).json({ error: 'Variation SKU is required in the path.' });
        }
        if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim() === '') {
            return res.status(400).json({ error: 'Image URL is required in the request body.' });
        }
        // Basic URL validation
        try {
            new URL(imageUrl);
        } catch (_) {
            return res.status(400).json({ error: 'Invalid Image URL format.' });
        }

        const trimmedSku = variationSku.trim();
        const trimmedImageUrl = imageUrl.trim();

        // Find the product and check if the variation exists (still good practice to validate context)
        const product = await productsCollection.findOne({ _id: productId });

        if (!product) {
            return res.status(404).json({ error: 'Product not found.' });
        }
        // Validate inventoryType and variation existence if necessary for the business logic,
        // even if the update target is otherMedia.
        if (product.inventoryType !== 'variation') {
             return res.status(400).json({ error: 'This operation context (variation image upload) is only supported for products with inventoryType "variation".' });
        }
        const variationExists = product.variations?.some(v => v.sku === trimmedSku);
        if (!variationExists) {
            return res.status(404).json({ error: `Variation with SKU "${trimmedSku}" not found for this product.` });
        }

        // --- Update Operation: Add to product's otherMedia array ---
        const result = await productsCollection.updateOne(
            { _id: productId }, // Find the product by ID
            {
                // Push the new image object to the top-level otherMedia array
                $push: {
                    otherMedia: { type: "image", src: trimmedImageUrl, variationSku: trimmedSku }
                },
                $currentDate: { lastModified: true }
            }
            // No arrayFilters needed here as we update the top-level field
        );

        if (result.matchedCount === 0) {
             // Should not happen if product was found earlier
             console.error(`Failed to find product ${productId} during PATCH update for otherMedia.`);
            return res.status(404).json({ error: 'Product not found during update.' });
        }
        if (result.modifiedCount === 0) {
             console.warn(`Product ${productId} otherMedia PATCH via variation context did not modify the document.`);
        }

        // --- Response ---
        // Fetch the updated product to return its new state
        const updatedProduct = await productsCollection.findOne({ _id: productId });

        res.status(200).json({
            success: true,
            message: `Image added to product's otherMedia and linked to variation SKU "${trimmedSku}".`,
            data: updatedProduct // Return the full updated product document
        });

    } catch (error) {
        console.error('--- Error Adding Image to Product otherMedia (via Variation Context) ---');
        console.error('Timestamp:', new Date().toISOString());
        console.error('Product ID:', req.params.productId);
        console.error('Variation SKU Context:', req.params.variationSku);
        console.error('Request Body:', req.body);
        console.error('Error Name:', error.name);
        console.error('Error Message:', error.message);
        if (error.code) { console.error('MongoDB Error Code:', error.code); }
        console.error('Stack Trace:', error.stack);
        console.error('--------------------------------------------------------------------');
        res.status(500).json({ success: false, error: 'Failed to add image to product otherMedia. Please check server logs.' });
    }
});


module.exports = router; 