const { Router }  = require(`express`);
const MongoClient = require(`mongodb`).MongoClient;

module.exports = function () {
    const router        = Router();
    const express       = require(`express`);
    const mongoose      = require(`mongoose`);
    const { ObjectId }  = require(`mongodb`);

    function setCustomHeader(req, res, next) {
      const hToken = req.headers['h-token'];
      res.set('X-Client-Token', hToken);
      next();
    }

    function safeObjectId(id) {
      if (!ObjectId.isValid(id)) {
        return null;
      }
      return new ObjectId(id);
    }

    async function getClientData(clientToken) {
      const mongoClient = new MongoClient(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      try {
        await mongoClient.connect();
        const db = mongoClient.db('API');
        const clientsCollection = db.collection('clients');
        const clientData = await clientsCollection.findOne({ clientToken });
        return clientData;
      } catch (err) {
        console.error('Failed to fetch client data from MongoDB', err);
        throw err;
      } finally {
        await mongoClient.close();
      }
    }

    async function createMongoClient(uri, dbName) {
      const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      await client.connect();
      const db = client.db(dbName);
      return { client, db };
    }

    // GET Method
    router.get(`/:collection`, setCustomHeader, async (req, res) => {
      const hToken = req.headers['client-token-key'];
      const clientData = await getClientData(hToken);

      if (!clientData) {
        res.status(404).json({ message: 'Client not found' });
        return;
      }

      const { client, db } = await createMongoClient(
        clientData.connection.URI + "/" + clientData.connection.database + "?tls=true&authSource=admin",
        clientData.connection.database
      );

      const collectionName = req.params.collection;
      const collection = db.collection(collectionName);

      try {
        const items = await collection.find().toArray();
        await client.close();
        res.status(200).json(items);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    /*

    backend?tls=true&authSource=admin

    connections.forEach(item => {
        // Use MongoClient to connect to MongoDB
        const client = new MongoClient(item.connection.URI, {
          useNewUrlParser: true,
          useUnifiedTopology: true
        });
    
        client.connect(err => {
            if (err) {
                console.error(err);
                return;
            }

            function setCustomHeader(req, res, next) {
                const data      = global.ClientConfiguration;
                const foundData = data.find(item2 => item2.clientToken === item.clientToken);
                res.set('X-Client-Token', item.clientToken);
                res.set('X-Client-Source', foundData.source);
                res.set('X-Client-Name', foundData.clientId);
                next();
            }
    
            const db = client.db();

            // Get a single document by ID from a collection
            router.get(`/${item.clientToken}/:collection/:id`, setCustomHeader, async (req, res) => {
                const collectionName = req.params.collection;
                const documentId = req.params.id;
                const joinCollection = req.query.join; // Updated variable name
                const arrayField = req.query.sub; // Updated variable name
                const collection = db.collection(collectionName);
            
                try {
                const document = await collection.findOne({ _id: new ObjectId(documentId) });
            
                if (!document) {
                    res.status(404).json({ message: `Document not found` });
                    return;
                }
            
                if (joinCollection && arrayField) {
                    const joinColl = db.collection(joinCollection);
                    const idsToLookup = document[arrayField];
                    const joinedDocs = await joinColl.find({ _id: { $in: idsToLookup.map(id => new ObjectId(id)) } }).toArray();
                    document[arrayField] = joinedDocs;
                }
            
                res.status(200).json(document);
                } catch (err) {
                res.status(500).json({ message: err.message });
                }
            });

            router.post(`/${item.clientToken}/:collection`, setCustomHeader, async (req, res) => {
                const collectionName = req.params.collection;
                const collection = db.collection(collectionName);
                const { data, options } = req.body;
            
                try {
                    // Process the fieldType option
                    if (options && options.fieldType) {
                        options.fieldType.forEach(([field, type]) => {
                            if (type === `objectId` && data[field]) {
                                data[field] = new mongoose.Types.ObjectId(data[field]);
                            } else if (type === `number` && data[field]) {
                                data[field] = Number(data[field]);
                            }
                        });
                    }

                    if (options && options.existingFields) {
                      let existingFields = [];
                      for (let i = 0; i < options.existingFields.length; i++) {
                        const fields = options.existingFields[i];
                    
                        // Check if all fields have values in the data object
                        if (fields.every(field => data[field])) {
                          const existingItem = await collection.findOne({
                            $or: fields.map(field => ({ [field]: data[field] }))
                          });
                    
                          if (existingItem) {
                            existingFields = [...existingFields, ...fields];
                          }
                        }
                      }
                    
                      if (existingFields.length > 0) {
                        res.status(400).json({ message: "existing", fields: existingFields });
                        return;
                      }
                    }
            
                    if (options && options.uniqueFields) {
                        let duplicateFields = [];
                        for (let i = 0; i < options.uniqueFields.length; i++) {
                          const fields = options.uniqueFields[i];

                          for (let j = 0; j < fields.length; j++) {
                            const field = fields[j];
                            const existingItem = await collection.findOne({ [field]: data[field] });
                            if (existingItem) {
                                duplicateFields.push(field);
                            }
                          }
                        }
                        if (duplicateFields.length > 0) {
                            res.status(400).json({ message: "duplicate", fields: duplicateFields });
                            return;
                        }
                    }
            
                    // Create a text index for the fields provided in options.textIndexFields
                    if (options && options.textIndexFields) {
                        const indexFields = options.textIndexFields.reduce((obj, field) => {
                            obj[field] = `text`;
                            return obj;
                        }, {});
                        await collection.createIndex(indexFields);
                    }
            
                    // Add the createdAt field to store the current timestamp
                    data.createdAt = new Date();
            
                    const result = await collection.insertOne(data);
                    const insertedItem = await collection.findOne({ _id: result.insertedId });
                    res.status(200).json(insertedItem);
                } catch (err) {
                    res.status(500).json({ message: err.message });
                }
            });
            
            // Update a document by ID in a collection
            router.put(`/${item.clientToken}/:collection/:id`, setCustomHeader, async (req, res) => {
                const collectionName = req.params.collection;
                const collection = db.collection(collectionName);
                const { data, options } = req.body;
    
                try {
                    const id = new mongoose.Types.ObjectId(req.params.id);
    
                    // Check if options.unique is provided and find a document with the same field value
                    if (options && options.unique) {
                        const existingItem = await collection.findOne({ [options.unique]: data[options.unique], _id: { $ne: id } });
    
                        if (existingItem) {
                            res.status(400).json({ message: `Duplicate entry for the unique field: ${options.unique}` });
                            return;
                        }
                    }
    
                    // Add the updatedAt field to store the current timestamp
                    data.updatedAt = new Date();
    
                    const update = { $set: data };
                    const result = await collection.updateOne({ _id: id }, update);
    
                    if (result.matchedCount > 0) {
                        const updatedItem = await collection.findOne({ _id: id });
                        res.status(200).json(updatedItem);
                    } else {
                        res.status(404).json({ message: `Item not found` });
                    }
                } catch (err) {
                    res.status(400).json({ message: err.message });
                }
            });
    
            // Delete a document by ID from a collection
            router.delete(`/${item.clientToken}/:collection/:id`, setCustomHeader, async (req, res) => {
            const collectionName = req.params.collection;
            const collection = db.collection(collectionName);
            try {
                const id = new mongoose.Types.ObjectId(req.params.id);
                const result = await collection.deleteOne({ _id: id });
                if (result.deletedCount > 0) {
                res.status(200).json({ message: `Item deleted` });
                } else {
                res.status(404).json({ message: `Item not found` });
                }
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
            });
    
            router.post(`/${item.clientToken}/:collection/query`, setCustomHeader, async (req, res) => {
              try {
                // Extracting collection name from the request parameters
                const collectionName = req.params.collection;
                const collection = db.collection(collectionName);
            
                // Extracting request body parameters
                const { method, args, hidden, paging, sort } = req.body || {};
                let { page = 1, limit = 100 } = paging || {};
                const skip = (page - 1) * limit;
            
                // Checking if limit is 0 and adjusting it accordingly
                if (limit === 0) {
                  limit = undefined;
                }
            
                // Validating the request format
                if (!method || !Array.isArray(args)) {
                  res.status(400).json({ message: `Invalid request format` });
                  return;
                }
            
                if (method === `find`) {
                  // Handling the find method
                  const query = args[0];
            
                  // Mapping the _id.$in values to safe object IDs
                  if (query._id?.$in && Array.isArray(query._id.$in)) {
                    query._id.$in = query._id.$in.map((id) => safeObjectId(id));
                  }
            
                  // Setting the projection based on hidden fields
                  const projection = hidden
                    ? hidden.reduce((obj, field) => {
                        obj[field] = 0;
                        return obj;
                      }, {})
                    : null;
            
                  let result;
                  let total;
            
                  // Performing the find operation with pagination and sorting
                  if (limit !== undefined) {
                    result = await collection[method](query, projection)
                      .skip(skip)
                      .limit(limit)
                      .sort(sort) // Add sorting option
                      .toArray();
            
                    total = await collection[method](query).count();
                  } else {
                    result = await collection[method](query, projection)
                      .sort(sort) // Add sorting option
                      .toArray();
                    total = result.length;
                  }
            
                  const totalPages = Math.ceil(total / limit);
            
                  let response = result;
            
                  // Removing hidden fields from the response
                  if (hidden && Array.isArray(hidden)) {
                    response = result.map((item) => {
                      for (const field of hidden) {
                        delete item[field];
                      }
                      return item;
                    });
                  }
            
                  // Sending the response with pagination details if provided
                  if (paging) {
                    const { page = 1, limit = 100 } = paging;
                    res.status(200).json({
                      data: response,
                      total,
                      paging: { page, limit, totalPages },
                    });
                  } else {
                    res.status(200).json(response);
                  }
                } else if (method === 'aggregate') {
                  // Handling the aggregate method
                  const pipeline = args;
            
                  // Performing the aggregate operation
                  const result = await collection.aggregate(pipeline).toArray();
                  res.status(200).json(result);
                } else {
                  // Handling unsupported methods
                  res.status(400).json({ message: `Method not supported` });
                }
              } catch (err) {
                // Handling any errors that occur
                console.error(err);
                res.status(500).json({ message: "An error occurred" });
              }
            });
            
            
            router.post(`/${item.clientToken}/:collection/aggregate`, setCustomHeader, async (req, res) => {
              const collectionName = req.params.collection;
              const collection = db.collection(collectionName);
              try {
                const { pipeline } = req.body || {};
            
                if (!Array.isArray(pipeline)) {
                  res.status(400).json({ message: `Invalid request format` });
                  return;
                }
            
                // Apply additional modifications to the pipeline as needed
                const modifiedPipeline = pipeline.map((stage) => {
                  // Check if the stage has a $match operator and convert the _id field to ObjectId
                  if (stage.$match && stage.$match._id) {
                    stage.$match._id = safeObjectId(stage.$match._id);
                  }
                  return stage;
                });
            
                const result = await collection.aggregate(modifiedPipeline).toArray();
                res.status(200).json(result);
              } catch (err) {
                res.status(500).json({ message: err.message });
              }
            });
            
            // Search for documents in a collection
            router.post(`/${item.clientToken}/:collection/search`, setCustomHeader, async (req, res) => {
                const collectionName = req.params.collection;
                const collection = db.collection(collectionName);
                const query = req.body;
            
                try {
                const cursor = await collection.find(query);
                const results = await cursor.toArray();
                res.status(200).json(results);
                } catch (err) {
                res.status(500).json({ message: err.message });
                }
            });

            router.post(`/${item.clientToken}/:collection/count`, setCustomHeader, async (req, res) => {
              try {
                // Extracting collection name from the request parameters
                const collectionName = req.params.collection;
                const collection = db.collection(collectionName);
            
                // Extracting request body parameters
                const { args } = req.body || {};
            
                // Validating the request format
                if (!Array.isArray(args)) {
                  res.status(400).json({ message: `Invalid request format - ` . req.body });
                  return;
                }
            
                // Performing the count operation
                const query = { $and: args };
                const count = await collection.countDocuments(query);
            
                // Sending the count as the response
                res.status(200).json({ count });
              } catch (err) {
                // Handling any errors that occur
                console.error(err);
                res.status(500).json({ message: "An error occurred" });
              }
            });
    
            // Add, update, or remove an element in a subarray of a document
            router.post(`/${item.clientToken}/:collection/:documentId/:arrayField`, setCustomHeader, async (req, res) => {
                const collectionName = req.params.collection;
                const documentId = req.params.documentId;
                const arrayField = req.params.arrayField;
                const collection = db.collection(collectionName);
                const { action, element, newElement, type } = req.body;
    
                try {
                    const document = await collection.findOne({ _id: new ObjectId(documentId) });
                    if (!document) {
                        res.status(404).json({ message: `Document not found` });
                        return;
                    }
    
                    let arrayData = document[arrayField];
    
                    if (!arrayData || !Array.isArray(arrayData)) {
                        const update = { $set: { [arrayField]: [], updatedAt: new Date() } };
                        await collection.updateOne({ _id: new ObjectId(documentId) }, update);
                        const updatedDocument = await collection.findOne({ _id: new ObjectId(documentId) });
                        arrayData = updatedDocument[arrayField];
                    }
    
                    let convertedElement, convertedNewElement;
    
                    if (type === `objectId`) {
                        convertedElement = new mongoose.Types.ObjectId(element);
                        if (newElement) {
                            convertedNewElement = new mongoose.Types.ObjectId(newElement);
                        }
                    } else {
                        convertedElement = element;
                        convertedNewElement = newElement;
                    }
    
                    let update;
    
                    if (action === `add`) {
                        update = { $addToSet: { [arrayField]: convertedElement }, $set: { updatedAt: new Date() } };
                    } else if (action === `update`) {
                        const index = arrayData.findIndex(item => item.toString() === convertedElement.toString());
                        if (index < 0) {
                            res.status(404).json({ message: `Element ${element} not found in ${arrayField}` });
                            return;
                        }
                        update = { $set: { [`${arrayField}.${index}`]: convertedNewElement, updatedAt: new Date() } };
                    } else if (action === `remove`) {
                        update = { $pull: { [arrayField]: convertedElement }, $set: { updatedAt: new Date() } };
                    } else {
                        res.status(400).json({ message: `Invalid action` });
                        return;
                    }
    
                    await collection.updateOne({ _id: new ObjectId(documentId) }, update);
                    const finalUpdatedDocument = await collection.findOne({ _id: new ObjectId(documentId) });
                    res.status(200).json(finalUpdatedDocument);
                } catch (err) {
                    res.status(500).json({ message: err.message });
                }
            });
        });
      });

      */

  return router;
};