const express = require('express');
const router = express.Router();

// GET - ดึงข้อมูล promotions ทั้งหมด
router.get('/', async (req, res) => {
    try {
        const { db } = req;
        const collection = db.collection('promotion');
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        const promotions = await collection
            .find({})
            .skip(skip)
            .limit(limit)
            .toArray();
            
        const total = await collection.countDocuments({});
        
        res.json({
            success: true,
            data: promotions,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch promotions',
            error: error.message
        });
    }
});

// GET - ดึงข้อมูล promotion ตาม ID
router.get('/:id', async (req, res) => {
    try {
        const { db } = req;
        const { ObjectId } = require('mongodb');
        const collection = db.collection('promotion');
        
        const promotion = await collection.findOne({ _id: new ObjectId(req.params.id) });
        
        if (!promotion) {
            return res.status(404).json({
                success: false,
                message: 'Promotion not found'
            });
        }
        
        res.json({
            success: true,
            data: promotion
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch promotion',
            error: error.message
        });
    }
});

// POST - สร้าง promotion ใหม่
router.post('/', async (req, res) => {
    try {
        const { db } = req;
        const collection = db.collection('promotion');
        
        const promotionData = {
            ...req.body,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const result = await collection.insertOne(promotionData);
        
        res.status(201).json({
            success: true,
            message: 'Promotion created successfully',
            data: {
                _id: result.insertedId,
                ...promotionData
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to create promotion',
            error: error.message
        });
    }
});

// PUT - อัปเดต promotion
router.put('/:id', async (req, res) => {
    try {
        const { db } = req;
        const { ObjectId } = require('mongodb');
        const collection = db.collection('promotion');
        
        const updateData = {
            ...req.body,
            updatedAt: new Date()
        };
        
        const result = await collection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: updateData }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Promotion not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Promotion updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update promotion',
            error: error.message
        });
    }
});

// DELETE - ลบ promotion
router.delete('/:id', async (req, res) => {
    try {
        const { db } = req;
        const { ObjectId } = require('mongodb');
        const collection = db.collection('promotion');
        
        const result = await collection.deleteOne({ _id: new ObjectId(req.params.id) });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Promotion not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Promotion deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to delete promotion',
            error: error.message
        });
    }
});

// GET - ค้นหา promotions ตามเงื่อนไข
router.get('/search/:query', async (req, res) => {
    try {
        const { db } = req;
        const collection = db.collection('promotion');
        const { query } = req.params;
        
        const promotions = await collection
            .find({
                $or: [
                    { name: { $regex: query, $options: 'i' } },
                    { description: { $regex: query, $options: 'i' } },
                    { code: { $regex: query, $options: 'i' } }
                ]
            })
            .toArray();
        
        res.json({
            success: true,
            data: promotions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to search promotions',
            error: error.message
        });
    }
});

module.exports = router;
