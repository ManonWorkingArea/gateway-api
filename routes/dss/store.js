const express = require('express');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path if needed
const { ObjectId } = require('mongodb'); // Import ObjectId
const router = express.Router();

const cartsCollectionName = 'carts';
const productsCollectionName = 'products';
const inventoryCollectionName = 'inventorys';

// --- Get Stores ---
router.get('/', async (req, res) => {
    try {
        const db = req.client.db('dss'); // Assuming 'dss' database
        const storesCollection = db.collection('stores'); // Target 'stores' collection
        const ownerFromHeader = req.headers.owner; // Get owner from header

        // Build the filter based on the owner header
        const filter = {};
        if (ownerFromHeader && typeof ownerFromHeader === 'string' && ownerFromHeader.trim() !== '') {
            filter.owner = ownerFromHeader.trim();
            console.log(`[LOG] Filtering stores by owner: ${filter.owner}`);
        } else {
            console.log(`[LOG] No valid owner header provided. Fetching all stores.`);
            // Decide if owner is mandatory, if so:
            // return res.status(400).json({ success: false, error: 'Owner header is required to list stores.' });
        }

        // Fetch stores using the filter
        const stores = await storesCollection.find(filter).toArray();

        res.status(200).json({ success: true, data: stores });
    } catch (error) {
        console.error('Error fetching stores:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch stores' });
    }
});

// --- Add New Store ---
router.post('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const storesCollection = db.collection('stores');
        const ownerFromHeader = req.headers.owner; // Get owner from header

        const { name, address, ...storeData } = req.body; // Example fields

        // --- Validation ---
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ success: false, error: 'Store name is required and must be a non-empty string.' });
        }
        const trimmedName = name.trim();

        // Add more validation as needed (e.g., address)

        // Check for duplicates (e.g., same name for the same owner)
        const duplicateFilter = {
            name: { $regex: `^${trimmedName}$`, $options: 'i' }
        };
        if (ownerFromHeader) {
            duplicateFilter.owner = ownerFromHeader;
        } else {
             // If owner is mandatory, block creation without owner
             // return res.status(400).json({ success: false, error: 'Owner header is required to create a store.' });
             // Or handle stores without owners if allowed
        }
        const existingStore = await storesCollection.findOne(duplicateFilter);
        if (existingStore) {
            const ownerMsg = ownerFromHeader ? ` for owner "${ownerFromHeader}"` : '';
            return res.status(400).json({ success: false, error: `Store with name "${trimmedName}" already exists${ownerMsg}.` });
        }
        // --- End Validation ---

        // Create new store document
        const newStore = {
            name: trimmedName,
            address: address, // Add validated address
            ...storeData, // Include any other data passed
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Add owner if provided
        if (ownerFromHeader) {
            newStore.owner = ownerFromHeader;
            console.log(`[LOG] Adding store with owner: ${newStore.owner}`);
        } else {
             console.log(`[LOG] Adding store without specific owner.`);
             // Handle according to application logic (error or allow)
        }

        const result = await storesCollection.insertOne(newStore);
        const createdStore = await storesCollection.findOne({ _id: result.insertedId });

        res.status(201).json({ success: true, data: createdStore });
    } catch (error) {
        console.error('Error adding new store:', error);
        res.status(500).json({ success: false, error: 'Failed to add new store' });
    }
});

// Helper function to calculate final sale price according to new rules
const calculateFinalSalePrice = (item, priceModel) => {
    let retailPrice = typeof item.retailPrice === 'number' ? item.retailPrice : 0;
    let salePrice = typeof item.salePrice === 'number' ? item.salePrice : null;

    let finalPrice = retailPrice; // Initialize with retailPrice
    let activeRuleApplied = false;
    const now = new Date();

    if (Array.isArray(priceModel)) {
        priceModel.forEach(rule => {
            const startDate = rule.startDate ? new Date(rule.startDate) : null;
            const endDate = rule.endDate ? new Date(rule.endDate) : null;
            if (endDate) {
                endDate.setHours(23, 59, 59, 999); // End of day
            }

            const isActive = rule.enabled &&
                             (!startDate || now >= startDate) &&
                             (!endDate || now <= endDate);

            if (isActive && typeof rule.value === 'number' && rule.value > 0) {
                activeRuleApplied = true; // Mark that an active rule was found
                let discountedPrice = finalPrice; // Initialize with current final price

                if (rule.type === 'percent') {
                    // Always calculate discount from retailPrice
                    const discountAmount = (retailPrice * rule.value) / 100;
                    discountedPrice = retailPrice - discountAmount;
                } else if (rule.type === 'fixed') {
                    // Always calculate discount from retailPrice
                    discountedPrice = retailPrice - rule.value;
                }
                // Add other discount types if needed, calculated from retailPrice

                // Update finalPrice only if this rule offers a lower price than current finalPrice
                finalPrice = Math.min(finalPrice, discountedPrice);
            }
        });
    }

    // If NO active price_model rule was applied, THEN consider the salePrice
    if (!activeRuleApplied) {
        if (salePrice !== null && salePrice < retailPrice) {
            finalPrice = salePrice;
        }
        // Otherwise, finalPrice remains the initial retailPrice
    }

    // Ensure final price is not negative
    return Math.max(0, finalPrice);
};

// --- Get All Products (Filtered by Owner) ---
router.get('/products', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const productsCollection = db.collection('products');
        const ownerFilterValue = req.headers['owner']; // Access the 'owner' header
        const productFilter = {}; // Initialize empty filter object

        if (ownerFilterValue && typeof ownerFilterValue === 'string' && ownerFilterValue.trim() !== '') {
            productFilter.owner = ownerFilterValue.trim(); // Add owner filter if header is present and not empty
            console.log(`[LOG] Filtering products by owner: ${productFilter.owner}`);
        } else {
            console.log(`[LOG] No valid 'owner' header provided. Fetching all products.`);
            // No owner filter applied, will fetch all products matching other criteria
            // Consider if owner is mandatory for accessing products via store context
            // If so: return res.status(400).json({ success: false, error: 'Owner header is required to list products.' });
        }

        // Fetch Products based on Owner Filter
        const products = await productsCollection.find(productFilter).toArray();

        // Calculate final sale price and override the original salePrice field
        const productsWithUpdatedPrice = products.map(product => {
            // Shallow copy the product to avoid modifying the original array directly if needed elsewhere
            const processedProduct = { ...product };

            // Calculate and override salePrice for the main product
            processedProduct.salePrice = calculateFinalSalePrice(processedProduct, processedProduct.price_model);

            // Calculate and override salePrice for variations if they exist
            if (processedProduct.inventoryType === 'variation' && Array.isArray(processedProduct.variations)) {
                processedProduct.variations = processedProduct.variations.map(variation => {
                     // Shallow copy the variation
                    const processedVariation = { ...variation };
                    // Calculate and override salePrice for the variation
                    processedVariation.salePrice = calculateFinalSalePrice(processedVariation, processedProduct.price_model); // Use main product's price_model
                    return processedVariation;
                });
            }
            // Remove the price_model field from the final output if desired
            // delete processedProduct.price_model;

            return processedProduct;
        });


        res.status(200).json({ success: true, data: productsWithUpdatedPrice }); // Return products with updated price
    } catch (error) {
        console.error('Error fetching products within store context:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch products' });
    }
});

// --- Helper Function to get Available Stock for a SKU ---
// Calculates total stock across all locations based on product type and SKU.
const getAvailableStock = async (db, productId, productType, sku) => {
    if (!productId || !productType || !sku) {
        console.warn('[Stock Check] Invalid arguments: productId, productType, and sku are required.');
        return 0;
    }
    const trimmedSku = sku.trim();
    const inventoryCollection = db.collection(inventoryCollectionName);
    let pipeline = [];

    if (productType === 'simple') {
        // Simple product: Sum the top-level 'quantity' for the given productId
        pipeline = [
            { $match: { productId: productId } },
            {
                $group: {
                    _id: null,
                    totalStock: { $sum: "$quantity" }
                }
            }
        ];
        // Check if the provided SKU actually matches the simple product's main SKU?
        // This check should ideally happen *before* calling this function.
        // console.log(`[Stock Check] Simple product ${productId} - checking main quantity.`);

    } else if (productType === 'variation') {
        // Variation product: Sum the quantity for the specific SKU within the 'variations' array
        pipeline = [
            { $match: { productId: productId } }, // Match the product
            { $unwind: "$variations" }, // Deconstruct the variations array
            { $match: { "variations.sku": trimmedSku } }, // Match the specific SKU within variations
            {
                $group: {
                    _id: null, // Group all matching variation entries (across locations)
                    totalStock: { $sum: "$variations.quantity" }
                }
            }
        ];
        // console.log(`[Stock Check] Variation product ${productId} - checking SKU ${trimmedSku}.`);
    } else {
        console.warn(`[Stock Check] Unknown product type: ${productType} for productId: ${productId}`);
        return 0;
    }

    try {
        const stockResult = await inventoryCollection.aggregate(pipeline).toArray();
        if (stockResult.length > 0) {
            // console.log(`[Stock Check] Result for ${sku}:`, stockResult[0].totalStock);
            return stockResult[0].totalStock;
        } else {
            // console.log(`[Stock Check] No stock found for ${sku}.`);
            return 0; // No stock found
        }
    } catch (error) {
        console.error(`Error getting stock for SKU ${trimmedSku} (Product ${productId}, Type ${productType}):`, error);
        return 0; // Return 0 on error
    }
};

// ==============================
// Shopping Cart Endpoints
// ==============================

// --- GET /cart - Get User's Cart grouped by owner with details and updated prices ---
router.get('/cart', async (req, res) => {
    const userIdFromHeader = req.headers['user'];
    if (!userIdFromHeader) {
        return res.status(400).json({ success: false, error: "'user' header is required." });
    }
    const userIdObj = safeObjectId(userIdFromHeader);
    if (!userIdObj) {
         return res.status(400).json({ success: false, error: "Invalid 'user' header format (must be ObjectId)." });
    }

    try {
        const db = req.client.db('dss');
        const cartsCollection = db.collection(cartsCollectionName);
        const productsCollection = db.collection(productsCollectionName);
        const clustersCollection = db.collection('cluster'); // Assuming collection name is 'clusters'

        // 1. Find the user's cart
        const cart = await cartsCollection.findOne({ userId: userIdObj });

        // 2. Handle empty or non-existent cart
        if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
             // Return empty array for grouped data format
            return res.status(200).json({
                success: true,
                data: [] // Return empty array as no items to group
            });
        }

        // 3. Extract Product IDs and fetch Product Details
        const productIds = cart.items.map(item => item.productId).filter(Boolean);
        const uniqueProductIds = [...new Set(productIds)].map(id => safeObjectId(id)).filter(Boolean);

        let productsMap = new Map();
        if (uniqueProductIds.length > 0) {
            const productDocs = await productsCollection.find({ _id: { $in: uniqueProductIds } }).toArray();
            productDocs.forEach(doc => productsMap.set(doc._id.toString(), doc));
        }

        // 4. Process Cart Items and Group by Owner
        const itemsByOwner = new Map(); // Map<ownerIdString, enrichedItem[]>
        const ownerIds = new Set();

        const enrichedItemsPromises = cart.items.map(async (cartItem) => {
            const productDoc = productsMap.get(cartItem.productId?.toString());

            if (!productDoc) {
                console.warn(`[GET Cart Grouped] Product details not found for productId ${cartItem.productId} in cart for user ${userIdFromHeader}. Skipping item.`);
                return null; // Skip this item if product details are missing
            }

            const ownerId = productDoc.owner; // Assuming owner field exists on product
            const ownerIdString = ownerId?.toString();

            if (!ownerIdString) {
                console.warn(`[GET Cart Grouped] Product ${productDoc._id} has no owner. Assigning to 'unknown'.`);
                // Optionally assign to a default group or skip
                 // ownerIdString = 'unknown'; // Example: group under unknown
                 return null; // Or skip items without owner
            }

            ownerIds.add(ownerId); // Add the ObjectId to the set

            let itemDataForPrice = null;
            let fullItemData = { ...productDoc };

             if (productDoc.inventoryType === 'simple' && productDoc.sku === cartItem.sku) {
                 itemDataForPrice = productDoc;
            } else if (productDoc.inventoryType === 'variation' && Array.isArray(productDoc.variations)) {
                 const variation = productDoc.variations.find(v => v.sku === cartItem.sku);
                 if (variation) {
                     itemDataForPrice = variation;
                     fullItemData = { ...productDoc, ...variation };
                     delete fullItemData.variations;
                     delete fullItemData.price_model;
                 } else {
                      console.warn(`[GET Cart Grouped] Variation SKU ${cartItem.sku} not found in product ${productDoc._id}. Price/Data might be inaccurate.`);
                      itemDataForPrice = {};
                      fullItemData = { ...cartItem }; // Fallback to cart item data might be misleading
                 }
            } else {
                 console.warn(`[GET Cart Grouped] Mismatch or unknown type for cart item SKU ${cartItem.sku} and product ${productDoc._id}`);
                 itemDataForPrice = {};
                 fullItemData = { ...cartItem };
            }

            const currentSalePrice = calculateFinalSalePrice(itemDataForPrice, productDoc.price_model);

            const enrichedItem = {
                 ...fullItemData,
                 productId: productDoc._id,
                 sku: cartItem.sku,
                 quantity: cartItem.quantity,
                 salePrice: currentSalePrice,
                 retailPrice: itemDataForPrice?.retailPrice ?? productDoc.retailPrice,
                 name: fullItemData.name || productDoc.name,
                 mainImageUrl: productDoc.mainImageUrl,
                 imageUrl: fullItemData.imageUrl || cartItem.imageUrl || productDoc.mainImageUrl
                 // Keep product owner info for grouping, but maybe remove later
                 // owner: ownerIdString
            };

            // Add to the map grouped by owner
            if (!itemsByOwner.has(ownerIdString)) {
                itemsByOwner.set(ownerIdString, []);
            }
            itemsByOwner.get(ownerIdString).push(enrichedItem);

            return enrichedItem; // Return for consistency, though we use the map later
        });

        await Promise.all(enrichedItemsPromises); // Wait for all item processing

        // 5. Fetch Cluster (Owner) Details
        // Convert ownerIds from the Set (which should contain ObjectIds) into an array of valid ObjectIds for the query
        const ownerObjectIdsForQuery = Array.from(ownerIds)
            .map(id => safeObjectId(id)) // Ensure each element is an ObjectId
            .filter(Boolean); // Remove any null/invalid results from safeObjectId

        console.log("Owner IDs for Query:", ownerObjectIdsForQuery); // Log ID ที่จะใช้ query จริง
        let clustersMap = new Map();
        if (ownerObjectIdsForQuery.length > 0) {
            const clusterDocs = await clustersCollection.find({ _id: { $in: ownerObjectIdsForQuery } }).toArray();
            console.log("Found Clusters:", clusterDocs); // Log ผลลัพธ์ clusters ที่เจอ
            clusterDocs.forEach(doc => clustersMap.set(doc._id.toString(), doc));
        }

        // 6. Construct the final grouped response
        const groupedCarts = [];
        for (const [ownerIdStr, itemsList] of itemsByOwner.entries()) {
            const ownerDetails = clustersMap.get(ownerIdStr);
            groupedCarts.push({
                ownerDetails: ownerDetails || { _id: ownerIdStr, name: 'Unknown Owner/Cluster' }, // Provide fallback
                items: itemsList
            });
        }

        res.status(200).json({ success: true, data: groupedCarts });

    } catch (error) {
        console.error(`Error fetching grouped cart for user ${userIdFromHeader}:`, error);
        res.status(500).json({ success: false, error: 'Failed to fetch grouped cart.' });
    }
});

// --- POST /cart/items - Add Item to Cart ---
router.post('/cart/items', async (req, res) => {
    // const userId = req.user?._id;
    const userIdFromHeader = req.headers['user'];
    if (!userIdFromHeader) {
        return res.status(400).json({ success: false, error: "'user' header is required." });
    }
    const userIdObj = safeObjectId(userIdFromHeader);
    if (!userIdObj) {
         return res.status(400).json({ success: false, error: "Invalid 'user' header format (must be ObjectId)." });
    }

    const { sku, quantity } = req.body;

    // ... (Basic validation for sku, quantity)
    if (!sku || typeof sku !== 'string' || sku.trim() === '') {
        return res.status(400).json({ success: false, error: 'Valid SKU is required.' });
    }
    if (quantity == null || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ success: false, error: 'Quantity must be a positive integer.' });
    }
    const trimmedSku = sku.trim();
    const requestedQuantity = quantity;
    // No need for userIdObj validation here again

    try {
        // ... (db connection, collections)
        const db = req.client.db('dss');
        const productsCollection = db.collection(productsCollectionName);
        const cartsCollection = db.collection(cartsCollectionName);

        // ... (Find Product, Check Stock using userIdObj)
        // 1. Find Product Details by SKU
        const product = await productsCollection.findOne({
            $or: [
                { sku: trimmedSku },
                { "variations.sku": trimmedSku }
            ]
        });
        if (!product) {
            return res.status(404).json({ success: false, error: `Product with SKU "${trimmedSku}" not found.` });
        }
        const productId = product._id;
        const productType = product.inventoryType;

        // Determine item data and isVariation
        let itemData = null;
        let isVariation = false;
        if (product.sku === trimmedSku && productType === 'simple') {
             itemData = { ...product };
        } else if (productType === 'variation' && Array.isArray(product.variations)) {
             const variation = product.variations.find(v => v.sku === trimmedSku);
             if (variation) {
                 itemData = { ...variation };
                 isVariation = true;
             }
        }
        if (!itemData) {
            return res.status(404).json({ success: false, error: `Details for SKU "${trimmedSku}" could not be processed.` });
        }

        // 2. Find User's Cart
        let userCart = await cartsCollection.findOne({ userId: userIdObj }); // Use userIdObj from header
        let existingQuantityInCart = 0;
        if (userCart) {
            const existingItem = userCart.items.find(item => item.sku === trimmedSku);
            if (existingItem) {
                existingQuantityInCart = existingItem.quantity;
            }
        }

        // 3. Stock Check
        const availableStock = await getAvailableStock(db, productId, productType, trimmedSku);
        console.log(`[Cart Add] User: ${userIdFromHeader}, SKU: ${trimmedSku}, Req: ${requestedQuantity}, InCart: ${existingQuantityInCart}, Avail: ${availableStock}`);

        // 4. Check Availability
        const totalRequiredQuantity = existingQuantityInCart + requestedQuantity;
        if (totalRequiredQuantity > availableStock) {
             console.warn(`[Cart Add] User: ${userIdFromHeader}, Insufficient stock for SKU ${trimmedSku}. Required: ${totalRequiredQuantity}, Available: ${availableStock}`);
             return res.status(400).json({
                 success: false,
                 error: `Insufficient stock for SKU "${trimmedSku}". Only ${availableStock - existingQuantityInCart} more available.`,
                 availableToAdd: Math.max(0, availableStock - existingQuantityInCart)
             });
        }

        // 5. Calculate Final Price
        const finalSalePrice = calculateFinalSalePrice(itemData, product.price_model);

        // 6. Add or Update Item in Cart
        const itemPayload = {
            productId: productId,
            sku: trimmedSku,
            quantity: requestedQuantity,
            name: isVariation ? `${product.name} (${itemData.sku})` : product.name,
            price: finalSalePrice,
            imageUrl: isVariation ? (product.otherMedia?.find(m => m.variationSku === trimmedSku)?.src || product.mainImageUrl) : product.mainImageUrl
        };

        // ... (Update/Insert logic using userIdObj)
         if (userCart) {
            const existingItemIndex = userCart.items.findIndex(item => item.sku === trimmedSku);
            if (existingItemIndex > -1) {
                const newQuantity = userCart.items[existingItemIndex].quantity + requestedQuantity;
                await cartsCollection.updateOne(
                    { _id: userCart._id, "items.sku": trimmedSku },
                    { $set: { "items.$.quantity": newQuantity, "items.$.price": finalSalePrice, updatedAt: new Date() } }
                );
                 console.log(`[Cart Add] User: ${userIdFromHeader}, Updated quantity for SKU ${trimmedSku}.`);
            } else {
                itemPayload.quantity = requestedQuantity;
                await cartsCollection.updateOne(
                    { _id: userCart._id },
                    { $push: { items: itemPayload }, $set: { updatedAt: new Date() } }
                );
                 console.log(`[Cart Add] User: ${userIdFromHeader}, Added new SKU ${trimmedSku}.`);
            }
        } else {
            itemPayload.quantity = requestedQuantity;
            const newCart = {
                userId: userIdObj, // Use validated ObjectId
                owner: product.owner,
                items: [itemPayload], createdAt: new Date(), updatedAt: new Date()
            };
            const insertResult = await cartsCollection.insertOne(newCart);
            userCart = { ...newCart, _id: insertResult.insertedId };
             console.log(`[Cart Add] User: ${userIdFromHeader}, Created new cart.`);
        }

        // 7. Fetch the updated cart to return
        const updatedCart = await cartsCollection.findOne({ userId: userIdObj }); // Use userIdObj from header
        res.status(200).json({ success: true, data: updatedCart });

    } catch (error) {
        console.error(`Error adding item (SKU: ${sku}) to cart for user ${userIdFromHeader}:`, error);
        res.status(500).json({ success: false, error: 'Failed to add item to cart.' });
    }
});

// --- PUT /cart/items/:sku - Update Item Quantity ---
router.put('/cart/items/:sku', async (req, res) => {
    // const userId = req.user?._id;
    const userIdFromHeader = req.headers['user'];
     if (!userIdFromHeader) {
        return res.status(400).json({ success: false, error: "'user' header is required." });
    }
    const userIdObj = safeObjectId(userIdFromHeader);
     if (!userIdObj) {
         return res.status(400).json({ success: false, error: "Invalid 'user' header format (must be ObjectId)." });
    }

    const sku = req.params.sku;
    const { quantity } = req.body;
    // const userIdObj = safeObjectId(userId); // Already validated

    // ... (Basic validation for sku, quantity)
     if (!sku || typeof sku !== 'string' || sku.trim() === '') {
        return res.status(400).json({ success: false, error: 'Valid SKU parameter is required.' });
    }
     if (quantity == null || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ success: false, error: 'New quantity must be a positive integer (>= 1).' });
    }
     const trimmedSku = sku.trim();
     const newQuantity = quantity;

    try {
        // ... (db connection, collections)
         const db = req.client.db('dss');
         const cartsCollection = db.collection(cartsCollectionName);
         const productsCollection = db.collection(productsCollectionName);

        // 1. Find User's Cart
        const userCart = await cartsCollection.findOne({ userId: userIdObj }); // Use userIdObj from header
         if (!userCart) {
            return res.status(404).json({ success: false, error: 'Cart not found.' });
        }

        // ... (Find Item in Cart, Find Product Type, Check Stock using userIdObj)
         // 2. Find Item in Cart and get ProductId
        const itemIndex = userCart.items.findIndex(item => item.sku === trimmedSku);
        if (itemIndex === -1) {
            return res.status(404).json({ success: false, error: `Item with SKU "${trimmedSku}" not found in cart.` });
        }
        const currentQuantity = userCart.items[itemIndex].quantity;
        const productId = userCart.items[itemIndex].productId;

        // 3. Find Product Type
        const product = await productsCollection.findOne({ _id: productId });
        if (!product) {
             console.error(`[Cart Update] User: ${userIdFromHeader}, Product ${productId} for SKU ${trimmedSku} not found!`);
             return res.status(500).json({ success: false, error: 'Could not verify product for stock check.'});
        }
        const productType = product.inventoryType;

        // 4. Stock Check
        if (newQuantity > currentQuantity) {
            const quantityIncrease = newQuantity - currentQuantity;
            const availableStock = await getAvailableStock(db, productId, productType, trimmedSku);
            const canAdd = availableStock - currentQuantity;

            console.log(`[Cart Update] User: ${userIdFromHeader}, SKU: ${trimmedSku}, NewQty: ${newQuantity}, Increase: ${quantityIncrease}, Avail: ${availableStock}, CanAdd: ${canAdd}`);

            if (quantityIncrease > canAdd) {
                console.warn(`[Cart Update] User: ${userIdFromHeader}, Insufficient stock for SKU ${trimmedSku}.`);
                return res.status(400).json({
                    success: false,
                    error: `Insufficient stock to increase quantity for SKU "${trimmedSku}". Only ${canAdd} more available.`,
                    availableToAdd: Math.max(0, canAdd)
                });
            }
             console.log(`[Cart Update] User: ${userIdFromHeader}, Stock check passed for SKU ${trimmedSku}.`);
        } else {
             console.log(`[Cart Update] User: ${userIdFromHeader}, Decreasing quantity for SKU ${trimmedSku}. No stock check needed.`);
        }

        // 5. Update Quantity and Price
        let finalSalePrice = userCart.items[itemIndex].price;
        const itemDataForPrice = productType === 'variation'
            ? product.variations?.find(v => v.sku === trimmedSku) || {}
            : product;
        finalSalePrice = calculateFinalSalePrice(itemDataForPrice, product.price_model);

        const updateResult = await cartsCollection.updateOne(
            { _id: userCart._id, "items.sku": trimmedSku },
            { $set: { "items.$.quantity": newQuantity, "items.$.price": finalSalePrice, updatedAt: new Date() } }
        );
        console.log(`[Cart Update] User: ${userIdFromHeader}, Updated quantity for SKU ${trimmedSku}. Result:`, updateResult.modifiedCount);

        // 6. Fetch and return updated cart
        const updatedCart = await cartsCollection.findOne({ userId: userIdObj }); // Use userIdObj from header
        res.status(200).json({ success: true, data: updatedCart });

    } catch (error) {
        console.error(`Error updating quantity for item (SKU: ${sku}) in cart for user ${userIdFromHeader}:`, error);
        res.status(500).json({ success: false, error: 'Failed to update item quantity.' });
    }
});

// --- DELETE /cart/items/:sku - Remove Item from Cart ---
router.delete('/cart/items/:sku', async (req, res) => {
     // const userId = req.user?._id;
     const userIdFromHeader = req.headers['user'];
     if (!userIdFromHeader) {
        return res.status(400).json({ success: false, error: "'user' header is required." });
    }
    const userIdObj = safeObjectId(userIdFromHeader);
     if (!userIdObj) {
         return res.status(400).json({ success: false, error: "Invalid 'user' header format (must be ObjectId)." });
    }

    const sku = req.params.sku;
    // const userIdObj = safeObjectId(userId); // Already validated

     // ... (Basic validation for sku)
     if (!sku || typeof sku !== 'string' || sku.trim() === '') {
        return res.status(400).json({ success: false, error: 'Valid SKU parameter is required.' });
    }
    const trimmedSku = sku.trim();

    try {
        // ... (db connection, collections)
        const db = req.client.db('dss');
        const cartsCollection = db.collection(cartsCollectionName);

        // Find the cart and pull the item using userIdObj
        const updateResult = await cartsCollection.updateOne(
            { userId: userIdObj }, // Use userIdObj from header
            {
                $pull: { items: { sku: trimmedSku } },
                $set: { updatedAt: new Date() }
            }
        );

        // ... (Check results)
        if (updateResult.matchedCount === 0) {
             return res.status(404).json({ success: false, error: 'Cart not found.' });
        }
        if (updateResult.modifiedCount === 0) {
             return res.status(404).json({ success: false, error: `Item with SKU "${trimmedSku}" not found in cart.` });
        }

         console.log(`[Cart Remove] User: ${userIdFromHeader}, Removed SKU ${trimmedSku}.`);

        // Fetch and return updated cart using userIdObj
        const updatedCart = await cartsCollection.findOne({ userId: userIdObj }); // Use userIdObj from header
        res.status(200).json({ success: true, data: updatedCart });

    } catch (error) {
        console.error(`Error removing item (SKU: ${sku}) from cart for user ${userIdFromHeader}:`, error);
        res.status(500).json({ success: false, error: 'Failed to remove item from cart.' });
    }
});

// --- DELETE /cart - Clear User's Cart ---
router.delete('/cart', async (req, res) => {
     // const userId = req.user?._id;
     const userIdFromHeader = req.headers['user'];
     if (!userIdFromHeader) {
        return res.status(400).json({ success: false, error: "'user' header is required." });
    }
    const userIdObj = safeObjectId(userIdFromHeader);
     if (!userIdObj) {
         return res.status(400).json({ success: false, error: "Invalid 'user' header format (must be ObjectId)." });
    }

    // const userIdObj = safeObjectId(userId); // Already validated

    try {
        // ... (db connection, collections)
        const db = req.client.db('dss');
        const cartsCollection = db.collection(cartsCollectionName);

        // Find the cart and set items to empty array using userIdObj
        const updateResult = await cartsCollection.updateOne(
            { userId: userIdObj }, // Use userIdObj from header
            {
                $set: { items: [], updatedAt: new Date() }
            }
        );

        // ... (Check results)
        if (updateResult.matchedCount === 0) {
            console.log(`[Cart Clear] User: ${userIdFromHeader}, No cart found to clear.`);
             res.status(200).json({ success: true, message: 'Cart is already empty or does not exist.', data: { userId: userIdObj, items: [] } });
        } else {
             console.log(`[Cart Clear] User: ${userIdFromHeader}, Cleared items.`);
             const updatedCart = await cartsCollection.findOne({ userId: userIdObj }); // Use userIdObj from header
             res.status(200).json({ success: true, message: 'Cart cleared successfully.', data: updatedCart });
        }

    } catch (error) {
        console.error(`Error clearing cart for user ${userIdFromHeader}:`, error);
        res.status(500).json({ success: false, error: 'Failed to clear cart.' });
    }
});

// ==============================
// Order Endpoints
// ==============================

const ordersCollectionName = 'orders';
const storeOrdersCollectionName = 'store_orders';
const clustersCollectionName = 'cluster'; // Use cluster collection name


// --- POST /orders - Create a new Order --- 
router.post('/orders', async (req, res) => {
    const userIdFromHeader = req.headers['user'];
    if (!userIdFromHeader) {
        return res.status(400).json({ success: false, error: "'user' header is required." });
    }
    const userIdObj = safeObjectId(userIdFromHeader);
    if (!userIdObj) {
         return res.status(400).json({ success: false, error: "Invalid 'user' header format (must be ObjectId)." });
    }

    const { 
        items, 
        shippingAddress, 
        paymentMethod, 
        totalAmount, 
        shippingCost, 
        grandTotal
    } = req.body;

    // --- Basic Validation ---
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Order must contain at least one item.' });
    }
    if (!shippingAddress || typeof shippingAddress !== 'object') {
        return res.status(400).json({ success: false, error: 'Shipping address is required.' });
    }
    // Add more validation for address fields, paymentMethod, totals if needed
    if (typeof grandTotal !== 'number' || grandTotal <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid grand total.' });
    }

    const db = req.client.db('dss');
    const ordersCollection = db.collection(ordersCollectionName);
    const storeOrdersCollection = db.collection(storeOrdersCollectionName);
    const clustersCollection = db.collection(clustersCollectionName); // Use clustersCollection
    const cartsCollection = db.collection(cartsCollectionName); // Re-add initialization
    const productsCollection = db.collection(productsCollectionName); // Need products collection

    try {
        // --- Pre-validation: Ensure items have necessary fields ---
        if (!items.every(item => item.productId && item.sku && item.quantity && item.price && item.storeId)) {
            return res.status(400).json({ success: false, error: 'All items must include productId, sku, quantity, price, and storeId.' });
        }

        // 1. Gather all unique product IDs from the order
        const productIds = [...new Set(items.map(item => safeObjectId(item.productId)).filter(Boolean))];

        // 2. Fetch product details for all items in the order
        let productsMap = new Map();
        if (productIds.length > 0) {
            const productDocs = await productsCollection.find({ _id: { $in: productIds } }).toArray();
            productDocs.forEach(doc => productsMap.set(doc._id.toString(), doc));
        }

        // 3. Enrich items with product details (name, imageUrl) and validate stores
        const enrichedItems = [];
        const itemsByStore = {};
        const storeIds = new Set(); // StoreIds are ClusterIds

        for (const item of items) {
            const productDoc = productsMap.get(item.productId.toString());
            if (!productDoc) {
                console.warn(`[Create Order] Product details not found for productId ${item.productId}. Skipping item or failing order.`);
                // Option: skip this item or return an error
                return res.status(400).json({ success: false, error: `Product details not found for ID ${item.productId}. Cannot create order.` });
            }

            let itemName = productDoc.name;
            let itemImageUrl = productDoc.mainImageUrl;
            // Find variation details if applicable
            if (productDoc.inventoryType === 'variation' && Array.isArray(productDoc.variations)) {
                const variation = productDoc.variations.find(v => v.sku === item.sku);
                if (variation) {
                    // Optionally use variation name if available, otherwise stick to main name
                    // itemName = variation.name || productDoc.name; 
                    itemImageUrl = variation.imageUrl || productDoc.mainImageUrl; // Prefer variation image
                } else {
                    console.warn(`[Create Order] Variation SKU ${item.sku} not found in product ${productDoc._id} during enrichment.`);
                    // Handle case where SKU doesn't match any variation - potentially an error
                    return res.status(400).json({ success: false, error: `Variation SKU ${item.sku} not found for product ${item.productId}.` });
                }
            } else if (productDoc.inventoryType === 'simple' && productDoc.sku !== item.sku) {
                 console.warn(`[Create Order] Simple product SKU mismatch: Order SKU ${item.sku}, Product SKU ${productDoc.sku}`);
                 return res.status(400).json({ success: false, error: `SKU mismatch for simple product ${item.productId}.` });
            }

            const enrichedItem = {
                ...item,
                productId: safeObjectId(item.productId), // Ensure productId is ObjectId
                name: itemName,
                imageUrl: itemImageUrl,
                // Ensure storeId is ObjectId for grouping
                storeId: safeObjectId(item.storeId) 
            };
            enrichedItems.push(enrichedItem);

            // Group enriched items by storeId (ClusterId)
            const storeIdStr = enrichedItem.storeId.toString();
             if (!safeObjectId(storeIdStr)) { // Re-validate storeId format after potential conversion
                 return res.status(400).json({ success: false, error: `Invalid storeId (clusterId) format after enrichment: ${item.storeId}` });
             }
            storeIds.add(enrichedItem.storeId); // Add Cluster ObjectId
            if (!itemsByStore[storeIdStr]) {
                itemsByStore[storeIdStr] = [];
            }
            itemsByStore[storeIdStr].push(enrichedItem); // Add the item with name/image
        }

        // 4. Fetch Cluster Details (to verify existence)
        const storeObjectIds = Array.from(storeIds); 
        const clusterDocs = await clustersCollection.find({ _id: { $in: storeObjectIds } }, { projection: { _id: 1 } }).toArray(); 
        const clusterIdMap = new Map(); 
        const foundClusterIds = new Set();
        clusterDocs.forEach(doc => {
            const docIdStr = doc._id.toString();
            clusterIdMap.set(docIdStr, doc._id);
            foundClusterIds.add(docIdStr); 
        });

        // Verify all storeIds (clusterIds) exist
        for (const storeIdObj of storeObjectIds) {
            const storeIdStr = storeIdObj.toString();
            if (!foundClusterIds.has(storeIdStr)) {
                 return res.status(400).json({ success: false, error: `Cluster (Store) with ID ${storeIdStr} not found.` });
            }
        }
        
        // 5. Create the Main Order document using enriched items
        const mainOrder = {
            userId: userIdObj,
            orderNumber: `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
            items: enrichedItems, // Use items with name and imageURL
            shippingAddress: shippingAddress,
            paymentMethod: paymentMethod,
            totalAmount: totalAmount,
            shippingCost: shippingCost,
            grandTotal: grandTotal,
            status: 'pending', 
            storeOrderIds: [], 
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const mainOrderResult = await ordersCollection.insertOne(mainOrder);
        const mainOrderId = mainOrderResult.insertedId;

        // 6. Create Store-Specific Sub-Orders using grouped enriched items
        const createdStoreOrderIds = [];
        for (const storeIdStr in itemsByStore) {
            const storeItems = itemsByStore[storeIdStr]; // These items already have name/image
            const clusterId = clusterIdMap.get(storeIdStr);
            
            if (!clusterId) { 
                console.error(`[Create Order] Internal error: Cluster ID ${storeIdStr} not found in map after verification.`);
                continue; 
            }

            const ownerId = clusterId; 
            const storeTotalAmount = storeItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

            const storeOrder = {
                mainOrderId: mainOrderId,
                userId: userIdObj,
                storeId: clusterId,
                ownerId: ownerId, 
                orderNumber: `STORE-${storeIdStr.slice(-4)}-${mainOrderId.toString().slice(-4)}`,
                items: storeItems, // Use enriched items for this store
                shippingAddress: shippingAddress, 
                paymentMethod: paymentMethod, 
                storeTotalAmount: storeTotalAmount,
                status: 'pending', 
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const storeOrderResult = await storeOrdersCollection.insertOne(storeOrder);
            createdStoreOrderIds.push(storeOrderResult.insertedId);
            console.log(`[Create Order] Created store order ${storeOrderResult.insertedId} for cluster (store) ${storeIdStr} (Owner/Cluster: ${ownerId})`);
        }

        // 7. Update Main Order with Store Order IDs
        await ordersCollection.updateOne(
            { _id: mainOrderId },
            { $set: { storeOrderIds: createdStoreOrderIds, updatedAt: new Date() } }
        );

        // 8. Clear items from user's cart
        const skusToRemove = enrichedItems.map(item => item.sku);
        if (skusToRemove.length > 0) {
            const cartUpdateResult = await cartsCollection.updateOne(
                { userId: userIdObj },
                { 
                    $pull: { items: { sku: { $in: skusToRemove } } },
                    $set: { updatedAt: new Date() }
                }
            );
            if (cartUpdateResult.modifiedCount > 0) {
                console.log(`[Create Order] Cleared ${skusToRemove.length} items from cart for user ${userIdFromHeader}`);
            }
        }

        // 9. Fetch the final main order to return
        const finalOrder = await ordersCollection.findOne({ _id: mainOrderId });

        res.status(201).json({ success: true, data: finalOrder });

    } catch (error) {
        console.error(`Error creating order for user ${userIdFromHeader}:`, error);
        // Consider more specific error handling or cleanup if partial orders were created
        res.status(500).json({ success: false, error: 'Failed to create order.' });
    }
});

// --- Helper Function to Enrich Order Data ---
const enrichOrderData = async (order, db) => {
    if (!order) return null;

    const storeOrdersCollection = db.collection(storeOrdersCollectionName);
    const clustersCollection = db.collection(clustersCollectionName); 
    const productsCollection = db.collection(productsCollectionName);

    // 1. Fetch related store orders
    let fetchedStoreOrders = [];
    const storeOrderObjectIds = (order.storeOrderIds || [])
        .map(id => safeObjectId(id))
        .filter(Boolean);

    if (storeOrderObjectIds.length > 0) {
        fetchedStoreOrders = await storeOrdersCollection.find({
            _id: { $in: storeOrderObjectIds }
        }).toArray();
    }

    // 2. Fetch Latest Product Details for all items
    let allProductIds = [];
    if (order.items) {
        allProductIds.push(...order.items.map(item => item.productId).filter(Boolean));
    }
    fetchedStoreOrders.forEach(so => {
        if (so.items) {
            allProductIds.push(...so.items.map(item => item.productId).filter(Boolean));
        }
    });

    const uniqueProductIds = [...new Set(allProductIds.map(id => id?.toString()))]
        .map(idStr => safeObjectId(idStr))
        .filter(Boolean);

    let productsMap = new Map();
    if (uniqueProductIds.length > 0) {
        const productDocs = await productsCollection.find({ _id: { $in: uniqueProductIds } }).toArray();
        productDocs.forEach(doc => productsMap.set(doc._id.toString(), doc));
    }

    // Helper to update item details
    const updateItemDetails = (item) => {
        const productDoc = productsMap.get(item.productId?.toString());
        if (!productDoc) return item; 

        let updatedName = productDoc.description; // Using description as per user edit
        let updatedImageUrl = productDoc.mainImageUrl;

        if (productDoc.inventoryType === 'variation' && Array.isArray(productDoc.variations)) {
            const variation = productDoc.variations.find(v => v.sku === item.sku);
            if (variation) {
                updatedImageUrl = variation.imageUrl || productDoc.mainImageUrl;
            }
        }
        
        return { ...item, name: updatedName, imageUrl: updatedImageUrl };
    };

    // Update items in main order
    if (order.items) {
        order.items = order.items.map(updateItemDetails);
    }

    // Update items in fetched store orders
    fetchedStoreOrders = fetchedStoreOrders.map(so => {
        if (so.items) {
            so.items = so.items.map(updateItemDetails);
        }
        return so;
    });

    // 3. Fetch Cluster details
    const clusterIds = fetchedStoreOrders.map(so => so.storeId).filter(Boolean);
    let clusterDetailsMap = new Map();
    if (clusterIds.length > 0) {
        const uniqueClusterIds = [...new Set(clusterIds.map(id => id.toString()))]
                                   .map(idStr => safeObjectId(idStr))
                                   .filter(Boolean);
                                   
        if (uniqueClusterIds.length > 0) {
             const clusterDocs = await clustersCollection.find({
                 _id: { $in: uniqueClusterIds }
             }).toArray();
             clusterDocs.forEach(doc => clusterDetailsMap.set(doc._id.toString(), doc));
        }
    }

    // 4. Enhance store orders with cluster details
    const enhancedStoreOrders = fetchedStoreOrders.map(storeOrder => {
        const clusterDetails = clusterDetailsMap.get(storeOrder.storeId?.toString()) || null;
        return { ...storeOrder, clusterDetails: clusterDetails };
    });

    // 5. Return the complete order object
    return { ...order, storeOrders: enhancedStoreOrders };
};


// --- GET /orders - Get all Orders for the user ---
router.get('/orders', async (req, res) => {
    const userIdFromHeader = req.headers['user'];

    // Validate User ID
    if (!userIdFromHeader) {
        return res.status(400).json({ success: false, error: "'user' header is required." });
    }
    const userIdObj = safeObjectId(userIdFromHeader);
    if (!userIdObj) {
         return res.status(400).json({ success: false, error: "Invalid 'user' header format (must be ObjectId)." });
    }

    const db = req.client.db('dss');
    const ordersCollection = db.collection(ordersCollectionName);
    
    try {
        // 1. Fetch all orders for the user
        const userOrders = await ordersCollection.find({ userId: userIdObj }).sort({ createdAt: -1 }).toArray(); // Sort by newest first

        if (!userOrders || userOrders.length === 0) {
            return res.status(200).json({ success: true, data: [] }); // Return empty array if no orders
        }

        // 2. Enrich each order with details using the helper function
        const enrichedOrders = await Promise.all(
            userOrders.map(order => enrichOrderData(order, db))
        );

        res.status(200).json({ success: true, data: enrichedOrders.filter(Boolean) }); // Filter out potential nulls if enrichment fails

    } catch (error) {
        console.error(`Error fetching orders for user ${userIdFromHeader}:`, error);
        res.status(500).json({ success: false, error: 'Failed to fetch orders.' });
    }
});

// --- GET /orders/:id - Get a specific Order with details ---
router.get('/orders/:id', async (req, res) => {
    const userIdFromHeader = req.headers['user'];
    const orderIdParam = req.params.id;

    // Validate User ID
    if (!userIdFromHeader) {
        return res.status(400).json({ success: false, error: "'user' header is required." });
    }
    const userIdObj = safeObjectId(userIdFromHeader);
    if (!userIdObj) {
         return res.status(400).json({ success: false, error: "Invalid 'user' header format (must be ObjectId)." });
    }

    // Validate Order ID
    const orderIdObj = safeObjectId(orderIdParam);
    if (!orderIdObj) {
        return res.status(400).json({ success: false, error: "Invalid order ID format." });
    }

    const db = req.client.db('dss');
    const ordersCollection = db.collection(ordersCollectionName);
    
    try {
        // 1. Fetch the main order document, ensuring it belongs to the user
        const mainOrder = await ordersCollection.findOne({
            _id: orderIdObj,
            userId: userIdObj // Ensure the order belongs to the requesting user
        });

        if (!mainOrder) {
            return res.status(404).json({ success: false, error: 'Order not found or access denied.' });
        }

        // 2. Enrich the order data using the helper function
        const completeOrder = await enrichOrderData(mainOrder, db);

        if (!completeOrder) {
            // Should not happen if mainOrder was found, but handle defensively
            console.error(`[GET /orders/:id] Enrichment failed for order ${orderIdParam}`);
            return res.status(500).json({ success: false, error: 'Failed to retrieve complete order details.' });
        }

        res.status(200).json({ success: true, data: completeOrder });

    } catch (error) {
        console.error(`Error fetching order ${orderIdParam} for user ${userIdFromHeader}:`, error);
        res.status(500).json({ success: false, error: 'Failed to fetch order details.' });
    }
});

module.exports = router;

