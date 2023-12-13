const { Router } = require('express');
const admin = require('firebase-admin');
const axios = require('axios');

module.exports = function (clientConfig) {
  const router = Router();

  async function initializeFirebaseAdminSDK(clientConfig) {
    try {
      const response = await axios.get(clientConfig.connection.cert);
      const firebaseCredential = response.data;

      admin.initializeApp({
        credential: admin.credential.cert(firebaseCredential),
      });

      console.log('Firebase Admin SDK initialized with remote credential');
    } catch (error) {
      console.error('Failed to initialize Firebase Admin SDK with remote credential', error);
    }
  }

  const firestorePromise = initializeFirebaseAdminSDK(clientConfig).then(() => admin.firestore());

  // Get all documents from a collection
  router.get('/:collection', async (req, res) => {
    const collectionName = req.params.collection;
    const firestore = await firestorePromise;
    const collection = firestore.collection(collectionName);

    try {
      const snapshot = await collection.get();
      const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      res.status(200).json(items);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get a single document by ID from a collection
  router.get('/:collection/:id', async (req, res) => {
    const collectionName = req.params.collection;
    const documentId = req.params.id;
    const firestore = await firestorePromise;
    const collection = firestore.collection(collectionName);

    try {
      const document = await collection.doc(documentId).get();
      if (!document.exists) {
        res.status(404).json({ message: 'Document not found' });
        return;
      }
      const data = document.data();
      res.status(200).json({ id: document.id, ...data });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  return router;
};