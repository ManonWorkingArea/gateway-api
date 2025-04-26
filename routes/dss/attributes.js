const express = require('express');
const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path
// const { ObjectId } = require('mongodb'); // ObjectId might not be needed for term _id anymore
const router = express.Router();

// GET /attributes - List all global attribute definitions
router.get('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const attributesCollection = db.collection('product_attributes');
        const ownerFromHeader = req.headers.owner; // Get owner from header

        // --- Build the filter query ---
        const filterQuery = {};
        if (ownerFromHeader) {
            filterQuery.owner = ownerFromHeader; // Add owner filter if header exists
        }
        // If ownerFromHeader is null/undefined, filterQuery remains {}, fetching all for that owner context (or all if no owner context)

        // Fetch attributes based on the filter, sorted by name
        const attributes = await attributesCollection.find(filterQuery, { sort: { name: 1 } }).toArray();

        res.status(200).json({ success: true, data: attributes });
    } catch (error) {
        console.error('Error fetching attributes:', error);
        res.status(500).json({ error: 'Failed to fetch attributes' });
    }
});

// POST /attributes - Create a new global attribute definition (Removed term _id)
router.post('/', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const attributesCollection = db.collection('product_attributes');
        const { name, terms, mode } = req.body;
        const ownerFromHeader = req.headers.owner; // Get owner from header

        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Attribute name is required.' });
        }
        const trimmedName = name.trim();

        // Process terms if provided
        const processedTerms = [];
        if (Array.isArray(terms)) {
            const codes = new Set();
            const names = new Set();
            for (const term of terms) {
                 if (!term || typeof term.name !== 'string' || term.name.trim() === '' || !term.code || typeof term.code !== 'string' || term.code.trim() === '') {
                    return res.status(400).json({ error: `Each term must have a non-empty string 'name' and 'code'. Problem: ${JSON.stringify(term)}` });
                }
                const termName = term.name.trim();
                const termCode = term.code.trim();

                if (names.has(termName)) return res.status(400).json({ error: `Duplicate term name "${termName}" provided in terms.` });
                if (codes.has(termCode)) return res.status(400).json({ error: `Duplicate term code "${termCode}" provided in terms.` });

                names.add(termName);
                codes.add(termCode);

                // Removed _id generation
                processedTerms.push({
                    name: termName,
                    code: termCode
                });
            }
        }

        // Check uniqueness of attribute name
        // TODO: Decide if uniqueness should be per owner or global. Current check is global.
        const existingAttr = await attributesCollection.findOne({ name: trimmedName /*, owner: ownerFromHeader */ }); // Add owner here if needed for uniqueness scope
        if (existingAttr) {
            // If uniqueness is per owner, adjust error message accordingly
            return res.status(409).json({ error: `Attribute name "${trimmedName}" already exists.` });
        }

        const newAttribute = {
            name: trimmedName,
            mode: mode,
            terms: processedTerms,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Add owner if present in header
        if (ownerFromHeader) {
            newAttribute.owner = ownerFromHeader;
        }

        const result = await attributesCollection.insertOne(newAttribute);
        const createdAttribute = await attributesCollection.findOne({ _id: result.insertedId });
        res.status(201).json({ success: true, data: createdAttribute });
    } catch (error) {
        console.error('Error creating attribute:', error);
        res.status(500).json({ error: 'Failed to create attribute' });
    }
});

// GET /attributes/:id - Get single attribute definition
router.get('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const attributesCollection = db.collection('product_attributes');
        const attributeId = safeObjectId(req.params.id);
        if (!attributeId) return res.status(400).json({ error: 'Invalid Attribute ID format.' });

        const attribute = await attributesCollection.findOne({ _id: attributeId });
        if (!attribute) {
            return res.status(404).json({ error: 'Attribute not found.' });
        }
        res.status(200).json({ success: true, data: attribute });
    } catch (error) {
        console.error('Error fetching attribute:', error);
        res.status(500).json({ error: 'Failed to fetch attribute' });
    }
});


// PUT /attributes/:id - Update/Replace attribute definition (Removed term _id)
router.put('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const attributesCollection = db.collection('product_attributes');
        const attributeId = safeObjectId(req.params.id);
        if (!attributeId) return res.status(400).json({ error: 'Invalid Attribute ID format.' });

        const { name, terms } = req.body;
        const updateData = {};

        // For PUT, we usually expect all replaceable fields
        if (name === undefined || terms === undefined) {
             return res.status(400).json({ error: 'For PUT request, please provide both name and terms.' });
        }

        // Validate name
        if (!name || typeof name !== 'string' || name.trim() === '') {
           return res.status(400).json({ error: 'Attribute name cannot be empty.' });
       }
       updateData.name = name.trim();
       // Check uniqueness if name changed
       const existingAttr = await attributesCollection.findOne({ name: updateData.name, _id: { $ne: attributeId } });
       if (existingAttr) {
            return res.status(409).json({ error: `Attribute name "${updateData.name}" already exists.` });
        }

       // Validate and process terms for replacement (Removed term _id)
       const processedTerms = [];
       if (!Array.isArray(terms)) {
           return res.status(400).json({ error: 'terms must be an array.' });
       }
        const codes = new Set();
        const names = new Set();
       for (const term of terms) {
            if (!term || typeof term.name !== 'string' || term.name.trim() === '' || !term.code || typeof term.code !== 'string' || term.code.trim() === '') {
                return res.status(400).json({ error: `Each term must have a non-empty string 'name' and 'code'. Problem: ${JSON.stringify(term)}` });
            }
            const termName = term.name.trim();
            const termCode = term.code.trim();
            if (names.has(termName)) return res.status(400).json({ error: `Duplicate term name "${termName}" provided in terms.` });
            if (codes.has(termCode)) return res.status(400).json({ error: `Duplicate term code "${termCode}" provided in terms.` });
            names.add(termName);
            codes.add(termCode);
            // Removed _id generation
            processedTerms.push({ name: termName, code: termCode });
       }
       updateData.terms = processedTerms;

       updateData.updatedAt = new Date();

       // Use updateOne with $set to replace content
       const result = await attributesCollection.updateOne(
            { _id: attributeId },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Attribute not found.' });
        }
        const updatedDoc = await attributesCollection.findOne({ _id: attributeId });
        res.status(200).json({ success: true, data: updatedDoc });
    } catch (error) {
        console.error('Error updating attribute (PUT):', error);
        res.status(500).json({ error: 'Failed to update attribute' });
    }
});

// PATCH /attributes/:id - Partially update attribute definition (Removed term _id if terms provided)
router.patch('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const attributesCollection = db.collection('product_attributes');
        const attributeId = safeObjectId(req.params.id);
        if (!attributeId) return res.status(400).json({ error: 'Invalid Attribute ID format.' });

        const { name, terms, mode } = req.body;
        const updateFields = {};

        // Check and validate 'name' if provided
        if (name !== undefined) {
             if (!name || typeof name !== 'string' || name.trim() === '') {
                return res.status(400).json({ error: 'Attribute name cannot be empty when provided.' });
            }
            updateFields.name = name.trim();
             // Check uniqueness if name is being changed
            const existingAttr = await attributesCollection.findOne({ name: updateFields.name, _id: { $ne: attributeId } });
            if (existingAttr) {
                 return res.status(409).json({ error: `Attribute name "${updateFields.name}" already exists.` });
             }
        }

        // Check and validate 'terms' if provided (replace the whole array, Removed term _id)
        if (terms !== undefined) {
             if (!Array.isArray(terms)) {
                  return res.status(400).json({ error: 'terms must be an array.' });
             }
             const processedTerms = [];
             const codes = new Set();
             const names = new Set();
             for (const term of terms) {
                 if (!term || typeof term.name !== 'string' || term.name.trim() === '' || !term.code || typeof term.code !== 'string' || term.code.trim() === '') {
                     return res.status(400).json({ error: `Each term must have a non-empty string 'name' and 'code'. Problem: ${JSON.stringify(term)}` });
                 }
                const termName = term.name.trim();
                const termCode = term.code.trim();
                if (names.has(termName)) return res.status(400).json({ error: `Duplicate term name "${termName}" provided in terms.` });
                if (codes.has(termCode)) return res.status(400).json({ error: `Duplicate term code "${termCode}" provided in terms.` });
                names.add(termName);
                codes.add(termCode);
                // Removed _id generation
                processedTerms.push({ name: termName, code: termCode });
             }
             updateFields.terms = processedTerms;
        }

        // Check if there's anything to update
        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ error: 'No valid fields provided for update (name or terms).' });
        }

        // Add updatedAt timestamp
        updateFields.updatedAt = new Date();
        updateFields.mode = mode;

        // Perform the partial update using findOneAndUpdate
        const result = await attributesCollection.findOneAndUpdate(
            { _id: attributeId },
            { $set: updateFields },
            { returnDocument: 'after' }
        );

        if (!result.value) {
            return res.status(404).json({ error: 'Attribute not found.' });
        }
        res.status(200).json({ success: true, data: result.value });
    } catch (error) {
        console.error('Error updating attribute (PATCH):', error);
        res.status(500).json({ error: 'Failed to update attribute' });
    }
});

// DELETE /attributes/:id - Delete attribute definition
router.delete('/:id', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const attributesCollection = db.collection('product_attributes');
        const productsCollection = db.collection('products');
        const attributeId = safeObjectId(req.params.id);
        if (!attributeId) return res.status(400).json({ error: 'Invalid Attribute ID format.' });

        // **Important Check**: Check if this attribute is used in any product
        const relatedProduct = await productsCollection.findOne({ "attributes.attributeId": attributeId });
        if (relatedProduct) {
            return res.status(400).json({ error: 'Cannot delete attribute: It is currently assigned to one or more products.' });
        }

        const result = await attributesCollection.deleteOne({ _id: attributeId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Attribute not found.' });
        }
        res.status(200).json({ success: true, message: 'Attribute deleted successfully.' });
    } catch (error) {
        console.error('Error deleting attribute:', error);
        res.status(500).json({ error: 'Failed to delete attribute' });
    }
});

// POST /attributes/:id/terms - Add a single term (Removed term _id)
router.post('/:id/terms', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const attributesCollection = db.collection('product_attributes');
        const attributeId = safeObjectId(req.params.id);
        const { name, code, value } = req.body;
        const ownerFromHeader = req.headers.owner; // Get owner from header

        if (!attributeId) {
            return res.status(400).json({ error: 'Invalid Attribute ID format.' });
        }
        if (!name || typeof name !== 'string' || name.trim() === '' || !code || typeof code !== 'string' || code.trim() === '') {
            return res.status(400).json({ error: 'New term must have a non-empty string "name" and "code".' });
        }
        const trimmedName = name.trim();
        const trimmedCode = code.trim();

        // --- Find Attribute and Check Owner First ---
        const attributeDoc = await attributesCollection.findOne({ _id: attributeId });

        if (!attributeDoc) {
             return res.status(404).json({ error: 'Attribute not found.' });
        }

        // Check owner if header is present
        if (ownerFromHeader && attributeDoc.owner !== ownerFromHeader) {
             return res.status(403).json({ error: 'Permission denied: Attribute does not belong to the specified owner.' });
        }
        // Proceed if owner matches or no owner filter applied

        // --- Check for duplicate term name or code within the *existing* terms ---
        const existingTerm = attributeDoc.terms?.find(t => t.name === trimmedName || t.code === trimmedCode);
        if (existingTerm) {
             let conflictField = existingTerm.name === trimmedName ? 'name' : 'code';
             let conflictValue = existingTerm.name === trimmedName ? trimmedName : existingTerm.code; // Use correct conflict value
            return res.status(409).json({ error: `A term with ${conflictField} "${conflictValue}" already exists in this attribute.` });
        }

        // Prepare the new term object (without _id)
        const newTerm = {
            name: trimmedName,
            value: value,
            code: trimmedCode
            // No owner field needed for the term itself
        };

        // Add the new term using $push
        const result = await attributesCollection.findOneAndUpdate(
            { _id: attributeId }, // Filter remains the same
            {
                $push: { terms: newTerm },
                $currentDate: { updatedAt: true }
            },
            { returnDocument: 'after' } // Already ensures we get the updated doc
        );

        // Check if update was successful (result.value should exist if findOneAndUpdate succeeds)
        if (!result.value) {
            // This case should ideally not be reached if the initial findOne succeeded,
            // but it's good practice for robustness (e.g., race condition).
            console.error(`Attribute ${attributeId} found initially but update failed during term addition.`);
            return res.status(500).json({ error: 'Failed to add term after attribute was verified.' });
        }

        res.status(201).json({ success: true, message: "Term added successfully.", data: result.value });

    } catch (error) {
        console.error('Error adding attribute term:', error);
        res.status(500).json({ error: 'Failed to add attribute term.' });
    }
});

// PATCH /attributes/:id/terms/:termCode - Update a specific term's name and/or value
router.patch('/:id/terms/:termCode', async (req, res) => {
    try {
        const db = req.client.db('dss');
        const attributesCollection = db.collection('product_attributes');
        const attributeId = safeObjectId(req.params.id);
        const termCodeToUpdate = req.params.termCode; // Get term code from path
        const { name, value } = req.body; // Get new name and/or value from body
        const ownerFromHeader = req.headers.owner; // Get owner from header

        // --- Validation ---
        if (!attributeId) {
            return res.status(400).json({ error: 'Invalid Attribute ID format.' });
        }
        if (!termCodeToUpdate || typeof termCodeToUpdate !== 'string' || termCodeToUpdate.trim() === '') {
            return res.status(400).json({ error: 'Term code must be provided in the URL path.' });
        }
        // Validate fields in body if they are provided
        let trimmedNewName = null;
        if (name !== undefined) {
            if (typeof name !== 'string' || name.trim() === '') {
                 return res.status(400).json({ error: 'If provided, new term name must be a non-empty string.' });
            }
            trimmedNewName = name.trim();
        }
        let trimmedNewValue = null;
         if (value !== undefined) {
            if (typeof value !== 'string' || value.trim() === '') {
                 return res.status(400).json({ error: 'If provided, term value must be a non-empty string.' });
            }
            trimmedNewValue = value.trim();
        }
        // Check if at least one field to update is provided
        if (trimmedNewName === null && trimmedNewValue === null) {
             return res.status(400).json({ error: 'No valid fields (name or value) provided for update.' });
        }

        // --- Find Attribute and Check Owner ---
        const attributeDoc = await attributesCollection.findOne({ _id: attributeId });
        if (!attributeDoc) {
            return res.status(404).json({ error: 'Attribute not found.' });
        }
        if (ownerFromHeader && attributeDoc.owner !== ownerFromHeader) {
            return res.status(403).json({ error: 'Permission denied: Attribute does not belong to the specified owner.' });
        }

        // --- Check if Term Exists and Check Name Uniqueness if name is changing ---
        let termExists = false;
        let nameConflict = false;
        if (attributeDoc.terms && Array.isArray(attributeDoc.terms)) {
             for (const term of attributeDoc.terms) {
                 if (term.code === termCodeToUpdate) {
                     termExists = true;
                     // If name is being updated, check if the new name conflicts with *another* term's name
                     if (trimmedNewName && term.name !== trimmedNewName) {
                         if (attributeDoc.terms.some(otherTerm => otherTerm.code !== termCodeToUpdate && otherTerm.name === trimmedNewName)) {
                             nameConflict = true;
                             break;
                         }
                     }
                 }
                 // Also check if the new name conflicts generally if the target term might not be found yet
                 else if (trimmedNewName && term.name === trimmedNewName) {
                      // This handles the case where the new name conflicts even if the target term code wasn't found.
                      // The update below will handle non-existence of the target term.
                 }
             }
        }

        if (!termExists) {
            return res.status(404).json({ error: `Term with code "${termCodeToUpdate}" not found within this attribute.` });
        }
         if (nameConflict) {
             return res.status(409).json({ error: `Another term with the name "${trimmedNewName}" already exists in this attribute.` });
         }


        // --- Prepare Update Operation ---
        const updateSet = {};
        if (trimmedNewName !== null) {
            updateSet["terms.$[term].name"] = trimmedNewName;
        }
        if (trimmedNewValue !== null) {
             updateSet["terms.$[term].value"] = trimmedNewValue; // Add or update the value field
        }


        // --- Perform Update using arrayFilters ---
        const result = await attributesCollection.updateOne(
            { _id: attributeId },
            {
                $set: updateSet,
                $currentDate: { updatedAt: true }
            },
            {
                arrayFilters: [{ "term.code": termCodeToUpdate }] // Target the specific term by its code
            }
        );

        if (result.matchedCount === 0) {
             // Should not happen if attributeDoc was found earlier
            return res.status(404).json({ error: 'Attribute not found during update.' });
        }
        if (result.modifiedCount === 0) {
            // This could happen if the term existed but the provided name/value were the same as existing ones,
            // or if the arrayFilter didn't match (less likely after the check above).
            console.warn(`Update operation for term code "${termCodeToUpdate}" in attribute ${attributeId} did not modify the document.`);
             // Return the current document state as no changes were made
             const currentDoc = await attributesCollection.findOne({_id: attributeId});
             return res.status(200).json({ success: true, message: "Term found, but no changes applied (values might be the same).", data: currentDoc });
        }

        // Fetch the updated attribute to show the change
        const updatedAttribute = await attributesCollection.findOne({ _id: attributeId });
        res.status(200).json({ success: true, message: 'Term updated successfully.', data: updatedAttribute });

    } catch (error) {
        console.error('Error updating attribute term:', error);
        res.status(500).json({ error: 'Failed to update attribute term.' });
    }
});

// DELETE /attributes/:id/terms/:termCode - Delete a specific term by its code
router.delete('/:id/terms/:termCode', async (req, res) => { // Changed path to include termCode
    try {
        const db = req.client.db('dss');
        const attributesCollection = db.collection('product_attributes');
        const attributeId = safeObjectId(req.params.id);
        const termCodeToDelete = req.params.termCode; // Get term code from path parameter
        const ownerFromHeader = req.headers.owner; // Get owner from header

        // --- Validation ---
        if (!attributeId) {
            return res.status(400).json({ error: 'Invalid Attribute ID format.' });
        }
        if (!termCodeToDelete || typeof termCodeToDelete !== 'string' || termCodeToDelete.trim() === '') {
            // Trim the code if necessary for consistency, though path params usually don't need trimming
            const code = termCodeToDelete.trim();
            if (code === '') {
                 return res.status(400).json({ error: 'Term code must be provided in the URL path.' });
            }
            // Use the trimmed code for the rest of the logic
            // termCodeToDelete = code; // Reassign if trimming is desired, but likely not needed for path params
        }

        // --- Find Attribute and Check Owner First ---
        const attributeDoc = await attributesCollection.findOne({ _id: attributeId });
        if (!attributeDoc) {
            return res.status(404).json({ error: 'Attribute not found.' });
        }
        if (ownerFromHeader && attributeDoc.owner !== ownerFromHeader) {
            return res.status(403).json({ error: 'Permission denied: Attribute does not belong to the specified owner.' });
        }

        // --- Check if term actually exists before trying to pull ---
        const termExists = attributeDoc.terms?.some(t => t.code === termCodeToDelete);
        if (!termExists) {
             return res.status(404).json({ error: `Term with code "${termCodeToDelete}" not found within this attribute.` });
         }

        // --- Remove the term using $pull based on code from path ---
        const result = await attributesCollection.updateOne(
            { _id: attributeId },
            {
                // Pull the term where the code matches the one from the path
                $pull: { terms: { code: termCodeToDelete } },
                $currentDate: { updatedAt: true }
            }
        );

         if (result.matchedCount === 0) { // Should not happen after findOne
            return res.status(404).json({ error: 'Attribute not found during delete operation.' });
        }
        // modifiedCount should be 1 if termExists check passed
        if (result.modifiedCount === 0) {
             console.warn(`Delete operation for term code "${termCodeToDelete}" in attribute ${attributeId} did not modify the document, despite prior existence check.`);
             // Still return success as the term is effectively gone or wasn't there after check
        }

        const updatedAttribute = await attributesCollection.findOne({ _id: attributeId });
        res.status(200).json({ success: true, message: 'Term deleted successfully.', data: updatedAttribute });

    } catch (error) {
        console.error('Error deleting attribute term:', error);
        res.status(500).json({ error: 'Failed to delete attribute term.' });
    }
});


module.exports = router; 