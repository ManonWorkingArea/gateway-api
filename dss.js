const express = require('express');
const { authenticateClient } = require('./routes/middleware/mongoMiddleware');
const router = express.Router();

// Import Routers
const clusterRoutes = require('./routes/dss/cluster');
const omRoutes = require('./routes/dss/om');
const vcRoutes = require('./routes/dss/vc');
const subVcRoutes = require('./routes/dss/sub_vc');
const userRoutes = require('./routes/dss/users');
const authRoutes = require('./routes/dss/auth');
const billRoutes = require('./routes/dss/bills');
const productRoutes = require('./routes/dss/products');
const inventoryRoutes = require('./routes/dss/inventorys');
const attributeRoutes = require('./routes/dss/attributes');
const suppliersRouter = require('./routes/dss/suppliers');
const storeRoutes = require('./routes/dss/store');
const promotionRoutes = require('./routes/dss/promotions');

// Middleware to authenticate client
router.use(authenticateClient);

// Mount Routers
router.use('/cluster', clusterRoutes);
// Alias plural path for compatibility
router.use('/clusters', clusterRoutes);
router.use('/om', omRoutes);
router.use('/vc', vcRoutes);
router.use('/sub_vc', subVcRoutes);
router.use('/users', userRoutes);
router.use('/auth', authRoutes);
router.use('/bills', billRoutes);
router.use('/products', productRoutes);
router.use('/inventorys', inventoryRoutes);
router.use('/attributes', attributeRoutes);
router.use('/suppliers', suppliersRouter);
router.use('/store', storeRoutes);
router.use('/promotions', promotionRoutes);
module.exports = router; 