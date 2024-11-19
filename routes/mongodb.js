// mongodb.js

const { Router } = require('express');
const CryptoJS = require('crypto-js');
const { createEvent, createEvents } = require('ics');

const {
  authenticateClient,
  safeObjectId,
  errorHandler
} = require('./middleware/mongoMiddleware');

module.exports = function () {
  const router = Router();
  router.use(authenticateClient);

  router.post('/multi-count', async (req, res, next) => {
    try {
      const { db } = req;
      const { collections } = req.body;
  
      // Validate input
      if (!collections || !Array.isArray(collections) || collections.length === 0) {
        return res.status(400).json({ status: false, message: 'Invalid input: collections array is required' });
      }
  
      // Get the start and end dates for the current month
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  
      // Run count queries for each collection in parallel
      const countPromises = collections.map(async (collectionName) => {
        const collection = db.collection(collectionName);
  
        // Count all documents
        const allTimeCount = await collection.countDocuments();
  
        // Count documents created within the current month
        const currentMonthCount = await collection.countDocuments({
          createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        });
  
        return {
          [collectionName]: {
            allTime: allTimeCount,
            currentMonth: currentMonthCount,
          },
        };
      });
  
      // Resolve all count promises
      const countResults = await Promise.all(countPromises);
  
      // Merge count results into a single object
      const counts = countResults.reduce((acc, count) => ({ ...acc, ...count }), {});
  
      res.status(200).json({ status: true, counts });
    } catch (err) {
      next(err);
    }
  });
  

  
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

  router.post('/chkrequest', async (req, res) => {
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

  // New /getHost endpoint to retrieve data by hostname
  router.get('/getHost', async (req, res) => {
    try {
      const { db } = req;
      const { hostname } = req.query;

      // Validate hostname parameter
      if (!hostname) {
        return res.status(400).json({ status: false, message: 'Hostname is required' });
      }

      // Query the 'hostnameCollection' for the given hostname
      const hostnameCollection = db.collection('hostname'); // Adjust collection name accordingly
      const hostResult = await hostnameCollection.findOne({ hostname: hostname });

      if (!hostResult) {
        return res.status(404).json({ status: false, message: 'No data found for the provided hostname' });
      }

      // Query the 'space' collection using the spaceId from the hostResult
      const spaceCollection = db.collection('space'); // Adjust collection name accordingly
      const spaceResult = await spaceCollection.findOne({ _id: safeObjectId(hostResult.spaceId) });

      if (!spaceResult) {
        return res.status(404).json({ status: false, message: 'No space data found for the provided spaceId' });
      }

      // Query the 'translate' collection to get all data
      const translateCollection = db.collection('translate'); // Adjust collection name accordingly
      const translateResult = await translateCollection.find().toArray();

      // Return the combined data from hostname, space, and translate collections
      res.status(200).json({
        status: true,
        hostData: hostResult,
        spaceData: spaceResult,
        translateData: translateResult,
      });
    } catch (err) {
      console.error('Error retrieving data by hostname:', err);
      res.status(500).json({ status: false, message: 'An error occurred while retrieving data' });
    }
  });

  router.post('/getTheme', async (req, res) => {
    try {
      const { db } = req;
      const { data } = req.body;

      // Validate input: Ensure data is an object and not empty
      if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        return res.status(400).json({ status: false, message: 'Invalid input: Data object is required' });
      }

      // Filter out any empty values and convert the values of the input object to an array of ObjectIds
      const objectIds = Object.values(data).filter(id => id).map(id => safeObjectId(id));

      // Query the 'post' collection to find documents matching the provided ObjectIds, only selecting the 'builder' key
      const postCollection = db.collection('post'); // Adjust collection name accordingly
      const posts = await postCollection.find(
        { _id: { $in: objectIds } },
        { projection: { builder: 1 } } // Only return the 'builder' key
      ).toArray();

      // Create a response object that maps the input keys to the corresponding builder data
      const result = Object.keys(data).reduce((acc, key) => {
        if (data[key]) {
          const post = posts.find(post => post._id.toString() === data[key]);
          acc[key] = post ? { builder: post.builder, id: post._id, seo: post.seo } : null;
        } else {
          acc[key] = null;
        }
        return acc;
      }, {});

      // Return the found builder data
      res.status(200).json({ status: true, data: result });
    } catch (err) {
      console.error('Error retrieving posts by IDs:', err);
      res.status(500).json({ status: false, message: 'An error occurred while retrieving posts' });
    }
  });
  
  router.post('/changepwd', async (req, res) => {
    try {
        const { client, db } = req;
        const { newPassword, requestId } = req.body;

        console.log("Processing password change request:", requestId);

        // Validate input
        if (!newPassword || !requestId) {
            return res.status(400).json({ status: false, message: 'New password and request ID are required' });
        }

        // Find the request by ID
        const requestCollection = db.collection('request');
        const requestData = await requestCollection.findOne({ _id: safeObjectId(requestId) });

        if (!requestData) {
            return res.status(404).json({ status: false, message: 'Request not found' });
        }

        // Check if the request has expired or is not pending
        const currentDate = new Date();
        if (currentDate > requestData.expiredate || requestData.status !== 'pending') {
            return res.status(400).json({ status: false, message: 'Request is invalid or has expired' });
        }

        // Get the user ID from the request data
        const userId = requestData.userID;

        // Generate a new salt and hash the new password
        const salt = CryptoJS.lib.WordArray.random(16).toString();
        const hash = CryptoJS.SHA256(newPassword + salt).toString();

        // Update the user's password in the user collection
        const userCollection = db.collection('user');
        await userCollection.updateOne(
            { _id: safeObjectId(userId) },
            {
                $set: {
                    password: hash,
                    salt: salt,
                }
            }
        );

        // Update the request status to 'complete' if password change is successful
        await requestCollection.updateOne(
            { _id: safeObjectId(requestId) },
            { $set: { status: 'complete' } }
        );

        // Return success response
        return res.status(200).json({ status: true, message: 'Password changed successfully' });

    } catch (err) {
        console.error('Error changing password:', err);
        return res.status(500).json({ status: false, message: 'An error occurred while changing the password' });
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

// GET Appointment by calendarId
router.get('/appointment/:id', async (req, res) => {
  try {
    const { db } = req;
    const calendarId = req.params.id;
    const keyQueryParam = req.query.key;

    if (!calendarId) {
      return res.status(400).json({ status: false, message: 'calendarId is required' });
    }

    const calendarObjectId = safeObjectId(calendarId);

    if (!calendarObjectId) {
      return res.status(400).json({ status: false, message: 'Invalid calendarId format' });
    }

    const collection = db.collection('calendar_event');
    const appointments = await collection.find({ calendarId: calendarId }).toArray();

    if (!appointments.length) {
      return res.status(404).json({ status: false, message: 'No appointments found for this calendarId: ' + calendarId });
    }

    // Convert appointments to the ICS format
    const events = appointments.map((appointment) => {
      return {
        start: [
          parseInt(appointment.startDate.substr(0, 4)),
          parseInt(appointment.startDate.substr(5, 2)),
          parseInt(appointment.startDate.substr(8, 2))
        ],
        end: [
          parseInt(appointment.endDate.substr(0, 4)),
          parseInt(appointment.endDate.substr(5, 2)),
          parseInt(appointment.endDate.substr(8, 2))
        ],
        title: appointment.title,
        description: appointment.description || '',
        location: appointment.location || '',
        status: 'CONFIRMED',
      };
    });

    // Generate ICS file
    createEvents(events, (error, value) => {
      if (error) {
        console.error('Error creating ICS file:', error);
        return res.status(500).json({ status: false, message: 'An error occurred while generating the ICS file' });
      }

      // Send the ICS file as a download
      res.setHeader('Content-Disposition', 'attachment; filename=appointments.ics');
      res.setHeader('Content-Type', 'text/calendar');
      res.send(value);
    });
    
  } catch (err) {
    console.error('Error fetching appointments:', err);
    res.status(500).json({ status: false, message: 'An error occurred while fetching appointments' });
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

      const result = await collection.aggregate(modifiedPipeline, { allowDiskUse: true }).toArray();
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // Batch Update Endpoint
router.post('/:collection/batchUpdate', async (req, res, next) => { // <-- Add `next` here
  try {
    const { client, db } = req;
    const collectionName = req.params.collection;
    const collection = db.collection(collectionName);
    const { data } = req.body;

    // Validate input
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ status: false, message: 'Invalid input: Data array is required' });
    }

    // Prepare update operations
    const updateOperations = data.map(item => {
      if (!item._id) {
        throw new Error('Each item must contain an _id field');
      }
      const id = safeObjectId(item._id);
      const updateFields = { ...item };
      delete updateFields._id;
      return collection.updateOne({ _id: id }, { $set: updateFields });
    });

    // Execute updates in parallel
    const results = await Promise.all(updateOperations);

    // Calculate results
    const matchedCount = results.reduce((acc, res) => acc + res.matchedCount, 0);
    const modifiedCount = results.reduce((acc, res) => acc + res.modifiedCount, 0);

    res.status(200).json({
      status: true,
      message: `${matchedCount} documents matched, ${modifiedCount} documents updated.`,
    });
  } catch (err) {
    console.error('Error in batchUpdate:', err);
    next(err); // <-- Pass error to the error-handling middleware
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