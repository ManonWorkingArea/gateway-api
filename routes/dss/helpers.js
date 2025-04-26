const { safeObjectId } = require('../middleware/mongoMiddleware'); // Adjust path if needed

// Helper function to get nested OM, VC, SubVC data by Cluster ID
const getNestedOmDataByClusterId = async (db, clusterId) => {
    const omCollection = db.collection('om');
    const vcCollection = db.collection('vc');
    const subVcCollection = db.collection('sub_vc');

    // Find OM data by clusterId
    const omData = await omCollection.find({ clusterId: clusterId }).toArray();

    // For each OM item, find related VC data and nest it
    for (let omItem of omData) {
        const vcData = await vcCollection.find({ omId: omItem._id.toString() }).toArray();

        // For each VC item, find related Sub VC data and nest it
        for (let vcItem of vcData) {
            const subVcData = await subVcCollection.find({ vcId: vcItem._id.toString() }).toArray();
            vcItem.subVcData = subVcData; // Nest Sub VC data under each VC item
        }

        omItem.vcData = vcData; // Nest VC data under each OM item
    }
    return omData; // Return the fully nested data
};

// Helper function to find or create a person (supplier/customer) - Return ID as string
const findOrCreatePerson = async (db, name, address, type) => {
    const peoplesCollection = db.collection('peoples');
    // Ensure 'peoples' collection exists
    const collections = await db.listCollections({ name: 'peoples' }).toArray();
    if (collections.length === 0) {
        await db.createCollection('peoples');
    }

    const existingPerson = await peoplesCollection.findOne({ name: name, type: type });

    if (existingPerson) {
        return existingPerson._id.toString(); // Convert existing ObjectId to string
    } else {
        const newPerson = {
            name: name,
            address: address,
            type: type,
            createdAt: new Date()
        };
        const result = await peoplesCollection.insertOne(newPerson);
        return result.insertedId.toString(); // Convert new ObjectId to string
    }
};

module.exports = {
    getNestedOmDataByClusterId,
    findOrCreatePerson
}; 