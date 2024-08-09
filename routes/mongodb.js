// mongodb.js

const { Router } = require('express');
const CryptoJS = require('crypto-js');

const {
  authenticateClient,
  safeObjectId,
  errorHandler
} = require('./middleware/mongoMiddleware');

module.exports = function () {
  const router = Router();
  router.use(authenticateClient);

  // Signin endpoint
  router.post('/signin', async (req, res) => {
    try {
        const { client, db } = req;
        const { username, password } = req.body;

        console.log("req",req);
        // Check if username and password are provided
        if (!username || !password) {
            return res.status(200).json({ status: false, message: 'Username and password are required' });
        }

        // Find the user in the database
        const collection = db.collection('user'); // Adjust the collection name as needed
        const userQuery = {
            method: 'find',
            args: [
                {
                    $and: [
                        { username: username }
                    ]
                }
            ]
        };
        const userResponse = await collection.find(userQuery.args[0]).toArray();
        const loginData = userResponse.length > 0 ? userResponse[0] : null;

        if (!loginData) {
            return res.status(200).json({ status: false, message: 'User not found' });
        }

        // Validate password
        const salt = loginData.salt;
        const inputHash = CryptoJS.SHA256(password + salt).toString();
        const storedHash = loginData.password;

        if (inputHash !== storedHash) {
            return res.status(200).json({ status: false, message: 'Invalid username or password' });
        }

        // Check user role
        if (loginData.role !== 'user') {
            return res.status(200).json({ status: false, message: 'Unauthorized to access this site' });
        }

        // Get User Enroll
        const enrollCollection = db.collection('enroll'); // Adjust the collection name as needed
        const enrollQuery = {
            method: 'find',
            hidden: ['userID'],
            args: [
                {
                    $and: [
                        { userID: loginData._id }
                    ]
                }
            ]
        };
        const enrollResponse = await enrollCollection.find(enrollQuery.args[0]).toArray();

        // Prepare session data
        let unitList = [];
        let currentAccess = "";

        const session = {
            active: true,
            token: loginData._id,
            refresh: "",
            login: true,
            userID: loginData._id,
            user: loginData,
            loader: false,
            role: loginData.role,
            nav: "normal-nav",
            layout: "frontend-layout",
            current: currentAccess,
            list: unitList,
            enroll: enrollResponse,
            channel: 'web',
        };

        // Respond with session data and success status
        res.status(200).json({ status: true, message: 'Signin successful', session });

    } catch (err) {
        console.error(err);
        res.status(200).json({ status: false, message: 'An error occurred' });
    }
  });

  router.post('/forgot', async (req, res) => {
    try {
        const { client, db } = req;
        const { email } = req.body;

        console.log("req", req);

        // Check if email is provided
        if (!email) {
            return res.status(200).json({ status: false, message: 'Email is required' });
        }

        // Find the user by email in the database
        const collection = db.collection('user'); // Adjust the collection name as needed
        const userQuery = {
            method: 'find',
            args: [
                {
                    $and: [
                        { email: email }
                    ]
                }
            ]
        };
        const userResponse = await collection.find(userQuery.args[0]).toArray();
        const userData = userResponse.length > 0 ? userResponse[0] : null;

        if (!userData) {
            return res.status(200).json({ status: false, message: 'Not found' });
        }

        // Prepare the user data to return (excluding sensitive information)
        const userResponseData = {
            userID: userData._id,
            username: userData.username,
            email: userData.email,
            firstname: userData.firstname,
            lastname: userData.lastname,
        };

        // Create an item in the 'request' collection
        const requestCollection = db.collection('request');
        const expireDate = new Date();
        expireDate.setHours(expireDate.getHours() + 24); // Set expiry to 24 hours from now

        const requestInsert = await requestCollection.insertOne({
            userID: userData._id.toString(),
            type: 'reset',
            status: 'pending',
            expiredate: expireDate,
        });

        // Add the inserted request ID to the response data
        userResponseData.requestId = requestInsert.insertedId;

        // Return success along with user data and request ID
        return res.status(200).json({ status: true, message: 'Found', user: userResponseData });

    } catch (err) {
        console.error(err);
        return res.status(200).json({ status: false, message: 'An error occurred' });
    }
  });

  router.post('/check_request', async (req, res) => {
    try {
        const { client, db } = req;
        const { requestId } = req.body;

        console.log("Checking request:", requestId);

        // Check if requestId is provided
        if (!requestId) {
            return res.status(200).json({ status: false, message: 'Request ID is required' });
        }

        // Find the request by ID in the database
        const requestCollection = db.collection('request'); // Adjust the collection name as needed
        const requestData = await requestCollection.findOne({ _id: safeObjectId(requestId) });

        if (!requestData) {
            return res.status(200).json({ status: false, message: 'Request not found' });
        }

        // Check if the request has expired
        const currentDate = new Date();
        if (currentDate > requestData.expiredate) {
            return res.status(200).json({ status: false, message: 'Request has expired' });
        }

        // Check if the request status is 'pending'
        if (requestData.status !== 'pending') {
            return res.status(200).json({ status: false, message: 'Request is not valid. Current status: ' + requestData.status });
        }

        // If request exists, is not expired, and status is 'pending', return success
        return res.status(200).json({ status: true, message: 'Request is valid' });

    } catch (err) {
        console.error('Error checking request:', err);
        return res.status(200).json({ status: false, message: 'An error occurred while checking the request' });
    }
  });

  router.get('/db-info', async (req, res) => {
    try {
      const { client, db } = req;
      const adminDb = client.db(req.clientData.connection.database);
      const databaseInfo = await adminDb.command({ dbStats: 1 });
      res.status(200).json(databaseInfo);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'An error occurred' });
    }
  });

  // GET Method
  router.get('/:collection', async (req, res) => {
    try {
      const { client, db } = req;
      const collectionName = req.params.collection;
      const collection = db.collection(collectionName);
      const items = await collection.find().toArray();
      res.status(200).json(items);
    } catch (err) {
      next(err);
    }
  });

  // GET Single Document
  router.get('/:collection/:id', async (req, res) => {
    try {
      const { client, db } = req;
      const collectionName = req.params.collection;
      const documentId = req.params.id;
      const joinCollection = req.query.join;
      const arrayField = req.query.sub;
      const collection = db.collection(collectionName);
      const document = await collection.findOne({ _id: safeObjectId(documentId) });

      if (!document) {
        res.status(404).json({ message: `Document not found` });
        return;
      }

      if (joinCollection && arrayField) {
        const joinColl = db.collection(joinCollection);
        const idsToLookup = document[arrayField];
        const joinedDocs = await joinColl
          .find({ _id: { $in: idsToLookup.map(id => safeObjectId(id)) } })
          .toArray();
        document[arrayField] = joinedDocs;
      }

      res.status(200).json(document);
    } catch (err) {
      next(err);
    }
  });

  // POST Method for Inserting a Document
  router.post('/:collection', async (req, res) => {
    try {
      const { client, db } = req;
      const collectionName = req.params.collection;
      const collection = db.collection(collectionName);
      const { data, options } = req.body;

      // Process the fieldType option
      if (options && options.fieldType) {
        options.fieldType.forEach(([field, type]) => {
          if (type === 'objectId' && data[field]) {
            data[field] = safeObjectId(data[field]);
          } else if (type === 'number' && data[field]) {
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
              $or: fields.map(field => ({ [field]: data[field] })),
            });

            if (existingItem) {
              existingFields = [...existingFields, ...fields];
            }
          }
        }

        if (existingFields.length > 0) {
          res.status(400).json({ message: 'existing', fields: existingFields });
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
          res.status(400).json({ message: 'duplicate', fields: duplicateFields });
          return;
        }
      }

      // Create a text index for the fields provided in options.textIndexFields
      if (options && options.textIndexFields) {
        const indexFields = options.textIndexFields.reduce((obj, field) => {
          obj[field] = 'text';
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
      next(err);
    }
  });


  // Update a document by ID in a collection
  router.put(`/:collection/:id`, async (req, res) => {
    try {
      const { client, db } = req;
      const collectionName = req.params.collection;
      const collection = db.collection(collectionName);
      const { data, options } = req.body;

      const id = safeObjectId(req.params.id);

      if (options && options.unique) {
        const existingItem = await collection.findOne({ [options.unique]: data[options.unique], _id: { $ne: id } });

        if (existingItem) {
          res.status(400).json({ message: `Duplicate entry for the unique field: ${options.unique}` });
          return;
        }
      }

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
      next(err);
    }
  });


  // Delete a document by ID from a collection
  router.delete(`/:collection/:id`, async (req, res) => {
    try {
      const { client, db } = req; // Access client and db from req object
      const collectionName = req.params.collection;
      const collection = db.collection(collectionName);

      const id = safeObjectId(req.params.id); // Safely parse the ObjectId

      const result = await collection.deleteOne({ _id: id });

      if (result.deletedCount > 0) {
        res.status(200).json({ message: `Item deleted` });
      } else {
        res.status(404).json({ message: `Item not found` });
      }
    } catch (err) {
      next(err);
    }
  });


  router.post(`/:collection/query`, async (req, res) => {
    try {
      const { client, db } = req; // Access client and db from req object
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
      next(err);
    }
  });


  router.post(`/:collection/aggregate`, async (req, res, next) => {
    try {
      const { client, db } = req; // Access client and db from req object
      const collectionName = req.params.collection;
      const collection = db.collection(collectionName);

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
      next(err);
    }
  });

  // Search for documents in a collection
  router.post(`/:collection/search`, async (req, res) => {
    try {
      const { client, db } = req; // Access client and db from req object
      const collectionName = req.params.collection;
      const collection = db.collection(collectionName);
      const query = req.body;
  
      const cursor = await collection.find(query);
      const results = await cursor.toArray();
      res.status(200).json(results);
    } catch (err) {
      next(err);
    }
  });
  

  router.post(`/:collection/count`, async (req, res) => {
    try {
      const { client, db } = req; // Access client and db from req object
      const collectionName = req.params.collection;
      const collection = db.collection(collectionName);
      const { args } = req.body || {};
  
      // Validating the request format
      if (!Array.isArray(args)) {
        res.status(400).json({ message: 'Invalid request format', requestBody: req.body });
        return;
      }
  
      // Performing the count operation
      const query = { $and: args };
      const count = await collection.countDocuments(query);
  
      // Sending the count as the response
      res.status(200).json({ count });
    } catch (err) {
      next(err);
    }
  });

  // Add, update, or remove an element in a subarray of a document
  router.post(`/:collection/:documentId/:arrayField`, async (req, res) => {
    try {
      const { client, db } = req; // Access client and db from req object
      const collectionName = req.params.collection;
      const documentId = req.params.documentId;
      const arrayField = req.params.arrayField;
      const collection = db.collection(collectionName);
      const { action, element, newElement, type } = req.body;
  
      const document = await collection.findOne({ _id: safeObjectId(documentId) });
      if (!document) {
        res.status(404).json({ message: `Document not found` });
        return;
      }
  
      let arrayData = document[arrayField];
  
      if (!arrayData || !Array.isArray(arrayData)) {
        const update = { $set: { [arrayField]: [], updatedAt: new Date() } };
        await collection.updateOne({ _id: safeObjectId(documentId) }, update);
        const updatedDocument = await collection.findOne({ _id: safeObjectId(documentId) });
        arrayData = updatedDocument[arrayField];
      }
  
      let convertedElement, convertedNewElement;
  
      if (type === `objectId`) {
        convertedElement = safeObjectId(element);
        if (newElement) {
          convertedNewElement = safeObjectId(newElement);
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
  
      await collection.updateOne({ _id: safeObjectId(documentId) }, update);
      const finalUpdatedDocument = await collection.findOne({ _id: safeObjectId(documentId) });
      res.status(200).json(finalUpdatedDocument);
    } catch (err) {
      next(err);
    }
  });
  router.use(errorHandler);
  return router;
};