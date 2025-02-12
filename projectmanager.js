const express = require('express');
const { authenticateClient, safeObjectId } = require('./routes/middleware/mongoMiddleware');
const router = express.Router();

// Middleware to authenticate client
router.use(authenticateClient);

// Get MongoDB collections
const getCollections = async (client) => {
    const db = client.db('ProjectManager');
    return {
        groups: db.collection('cluster_groups'),
        projects: db.collection('cluster_project'),
        tasks: db.collection('cluster_tasks'),
    };
};

// 📌 Create Group
router.post('/group', async (req, res) => {
    const { client } = req;
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: 'Group name is required' });

    try {
        const { groups } = await getCollections(client);
        const newGroup = { name, createdAt: new Date() };
        const result = await groups.insertOne(newGroup);

        res.status(201).json({ success: true, groupId: result.insertedId });
    } catch (error) {
        console.error('Error creating group:', error);
        res.status(500).json({ error: 'Failed to create group' });
    }
});

// 📌 Get All Groups (with projects & task count)
router.get('/groups', async (req, res) => {
    try {
        const { client } = req;
        const { groups, projects, tasks } = await getCollections(client);

        const allGroups = await groups.aggregate([
            {
                $lookup: {
                    from: 'cluster_project',
                    localField: '_id',
                    foreignField: 'groupId',
                    as: 'projects',
                },
            },
            {
                $unwind: {
                    path: '$projects',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $lookup: {
                    from: 'cluster_tasks',
                    localField: 'projects._id',
                    foreignField: 'projectId',
                    as: 'tasks',
                },
            },
            {
                $group: {
                    _id: '$_id',
                    name: { $first: '$name' },
                    createdAt: { $first: '$createdAt' },
                    projects: { $push: { _id: '$projects._id', name: '$projects.name' } },
                    totalTasks: { $sum: { $size: '$tasks' } },
                },
            },
        ]).toArray();

        res.status(200).json({ success: true, data: allGroups });
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});

// 📌 Get Single Group (with projects & task count)
router.get('/groups/:groupId', async (req, res) => {
    try {
        const { client } = req;
        const { groups, projects, tasks } = await getCollections(client);
        const groupId = req.params.groupId;

        console.log(groupId);

        const group = await groups.aggregate([
            {
                $match: { _id: safeObjectId(groupId) }, // Match specific group
            },
            {
                $lookup: {
                    from: 'cluster_project',
                    localField: '_id',
                    foreignField: 'groupId',
                    as: 'projects',
                },
            },
            {
                $unwind: {
                    path: '$projects',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $lookup: {
                    from: 'cluster_tasks',
                    localField: 'projects._id',
                    foreignField: 'projectId',
                    as: 'tasks',
                },
            },
            {
                $group: {
                    _id: '$_id',
                    name: { $first: '$name' },
                    createdAt: { $first: '$createdAt' },
                    projects: { 
                        $push: { 
                            _id: '$projects._id', 
                            name: '$projects.name' 
                        } 
                    },
                    totalTasks: { $sum: { $size: '$tasks' } },
                },
            },
        ]).toArray();

        if (!group.length) {
            return res.status(404).json({ success: false, error: 'Group not found',group });
        }

        res.status(200).json({ success: true, data: group[0] });
    } catch (error) {
        console.error('Error fetching group:', error);
        res.status(500).json({ error: 'Failed to fetch group' });
    }
});


// 📌 Add Project to Group
router.post('/project', async (req, res) => {
    const { client } = req;
    const { groupId, name, detail, color } = req.body;

    if (!groupId || !name) return res.status(400).json({ error: 'Group ID and Project name are required' });

    try {
        const { projects } = await getCollections(client);

        const newProject = {
            groupId: safeObjectId(groupId),
            name,
            color,
            detail,
            categories: [],
            statuses: [],
            createdAt: new Date(),
        };

        const result = await projects.insertOne(newProject);

        res.status(201).json({ success: true, projectId: result.insertedId });
    } catch (error) {
        console.error('Error adding project:', error);
        res.status(500).json({ error: 'Failed to add project' });
    }
});

// 📌 Get Projects by Group (with tasks)
router.get('/projects/:groupId', async (req, res) => {
    const { client } = req;
    const { groupId } = req.params;

    try {
        const { projects, tasks } = await getCollections(client);
        const allProjects = await projects.aggregate([
            { $match: { groupId: safeObjectId(groupId) } },
            {
                $lookup: {
                    from: 'cluster_tasks',
                    localField: '_id',
                    foreignField: 'projectId',
                    as: 'tasks',
                },
            },
        ]).toArray();

        res.status(200).json({ success: true, data: allProjects });
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// 📌 Add Task to Project (FIXED)
router.post('/task', async (req, res) => {
    const { client } = req;
    const { projectId, title, categoryId, statusId, priority, startDate, dueDate, detail, color } = req.body;

    if (!projectId || !title) return res.status(400).json({ error: 'Project ID and Task title are required' });

    try {
        const { tasks } = await getCollections(client);
        
        // Ensure categoryId and statusId are stored correctly
        const newTask = {
            projectId: safeObjectId(projectId),
            title,
            priority,
            startDate,
            dueDate,
            detail,
            color,
            categoryId: categoryId ? categoryId.toString() : null,
            statusId: statusId ? statusId.toString() : null,
            createdAt: new Date(),
        }; 

        const result = await tasks.insertOne(newTask);

        res.status(201).json({ success: true, taskId: result.insertedId, data: newTask });
    } catch (error) {
        console.error('Error adding task:', error);
        res.status(500).json({ error: 'Failed to add task' });
    }
});


// 📌 Get Tasks by Project
router.get('/tasks/:projectId', async (req, res) => {
    const { client } = req;
    const { projectId } = req.params;

    try {
        const { tasks } = await getCollections(client);
        const allTasks = await tasks.find({ projectId: safeObjectId(projectId) }).toArray();

        res.status(200).json({ success: true, data: allTasks });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

router.put('/task/:taskId', async (req, res) => {
    const { client } = req;
    const { taskId } = req.params;
    const { title, categoryId, statusId, subtasks, isCancelled } = req.body;

    if (!taskId) return res.status(400).json({ error: 'Task ID is required' });

    try {
        const { tasks, projects } = await getCollections(client);
        if (!tasks || !projects) return res.status(500).json({ error: 'Database collections not available' });

        const taskObjectId = safeObjectId(taskId);
        const existingTask = await tasks.findOne({ _id: taskObjectId });
        if (!existingTask) return res.status(404).json({ error: 'Task not found' });

        let fixedStatusId = statusId || existingTask.statusId;
        let fixedIsDone = false; // Default to false unless overridden

        // ✅ Fetch the related project and statuses
        const projectData = await projects.findOne({ _id: safeObjectId(existingTask.projectId) });
        if (!projectData || !projectData.statuses) {
            return res.status(404).json({ error: 'Project or statuses not found' });
        }

        // ✅ Find the first `isDone: true` status in the project
        const doneStatus = projectData.statuses.find(s => s.isDone === true);

        // ✅ Ensure `statusId` exists in the project
        if (statusId && !projectData.statuses.some(status => status.id === statusId)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        // ✅ Auto-set `task.isDone` based on `statusId`
        fixedIsDone = doneStatus && fixedStatusId === doneStatus.id;

        // ✅ Preserve incoming subtasks from request if provided
        let updatedSubtasks = subtasks ? [...subtasks] : [...(existingTask.subtasks || [])];

        // ✅ If the main task is marked as `isDone`, ensure all subtasks are completed
        if (fixedIsDone) {
            updatedSubtasks = updatedSubtasks.map(st => ({ ...st, completed: true }));
        }

        // ✅ Build update object
        const updateFields = {
            title,
            categoryId: categoryId?.toString(),
            statusId: fixedStatusId?.toString(),
            isDone: fixedIsDone,
            isCancelled: Boolean(isCancelled),
            subtasks: updatedSubtasks
        };

        // ✅ Remove undefined values
        Object.keys(updateFields).forEach(key => {
            if (updateFields[key] === undefined) delete updateFields[key];
        });

        const result = await tasks.updateOne({ _id: taskObjectId }, { $set: updateFields });

        if (result.modifiedCount === 0) {
            return res.status(404).json({ error: 'Task not found or no changes made' });
        }

        res.status(200).json({
            success: true,
            message: 'Task updated successfully',
            updatedFields: updateFields
        });
    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({ error: 'Failed to update task' });
    }
});


// 📌 Delete Task
router.delete('/task/:taskId', async (req, res) => {
    const { client } = req;
    const { taskId } = req.params;

    try {
        const { tasks } = await getCollections(client);
        const result = await tasks.deleteOne({ _id: safeObjectId(taskId) });

        if (!result.deletedCount) return res.status(404).json({ error: 'Task not found' });

        res.status(200).json({ success: true, message: 'Task deleted successfully' });
    } catch (error) {
        console.error('Error deleting task:', error);
        res.status(500).json({ error: 'Failed to delete task' });
    }
});



// 📌 Get All Tasks with Group and Project
router.get('/tasks', async (req, res) => {
    try {
        const { client } = req;
        const { groups, projects, tasks } = await getCollections(client);

        const allTasks = await tasks.aggregate([
            {
                $lookup: {
                    from: 'cluster_project',
                    localField: 'projectId',
                    foreignField: '_id',
                    as: 'project',
                },
            },
            {
                $unwind: {
                    path: '$project',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $lookup: {
                    from: 'cluster_groups',
                    localField: 'project.groupId',
                    foreignField: '_id',
                    as: 'group',
                },
            },
            {
                $unwind: {
                    path: '$group',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $project: {
                    _id: 1,
                    title: 1,
                    priority: 1,
                    startDate: 1,
                    dueDate: 1,
                    detail: 1,
                    categoryId: 1,
                    statusId: 1,
                    color: 1,
                    comment: 1,
                    createdAt: 1,
                    group: { _id: 1, name: 1, color: 1 }, // Group info
                    project: { _id: 1, name: 1, color: 1 }, // Project info
                },
            },
        ]).toArray();

        res.status(200).json({ success: true, data: allTasks });
    } catch (error) {
        console.error('Error fetching tasks with group and project:', error);
        res.status(500).json({ error: 'Failed to fetch tasks with group and project' });
    }
});

router.put('/comment/:taskId', async (req, res) => {
    const { client } = req;
    const { taskId } = req.params;
    const { parentCommentId, comment, deleteCommentId, deleteReplyId } = req.body;

    if (!taskId) return res.status(400).json({ error: 'Task ID is required' });

    try {
        const { tasks } = await getCollections(client);
        const taskObjectId = safeObjectId(taskId);

        // Find the task
        const task = await tasks.findOne({ _id: taskObjectId });
        if (!task) return res.status(404).json({ error: 'Task not found' });

        // 🛑 DELETE FUNCTIONALITY: Delete a reply inside a comment
        if (deleteCommentId && deleteReplyId) {
            const updatedTask = await tasks.findOneAndUpdate(
                { _id: taskObjectId, "comments.id": deleteCommentId },
                { $pull: { "comments.$.replies": { id: deleteReplyId } } },
                { returnDocument: 'after' }
            );

            if (!updatedTask) return res.status(404).json({ error: 'Comment or reply not found' });

            return res.status(200).json({ success: true, message: 'Reply deleted successfully', comments: updatedTask.comments });
        }

        // 🛑 DELETE FUNCTIONALITY: Delete a whole comment
        if (deleteCommentId && !deleteReplyId) {
            const updatedTask = await tasks.findOneAndUpdate(
                { _id: taskObjectId },
                { $pull: { comments: { id: deleteCommentId } } },
                { returnDocument: 'after' }
            );

            if (!updatedTask) return res.status(404).json({ error: 'Comment not found' });

            return res.status(200).json({ success: true, message: 'Comment deleted successfully', comments: updatedTask.comments });
        }

        // ✅ ADD FUNCTIONALITY: If adding a reply to an existing comment
        if (parentCommentId && comment) {
            const commentData = {
                id: comment.id,
                text: comment.text,
                owner: comment.owner,
                timestamp: comment.timestamp,
                type: comment.type,
                fileName: comment.fileName || null, // Store file name if available
                fileSize: comment.fileSize || null, // Store file size if available
            };

            const updatedTask = await tasks.findOneAndUpdate(
                { _id: taskObjectId, "comments.id": parentCommentId },
                { $push: { "comments.$.replies": commentData } },
                { returnDocument: 'after' }
            );

            if (!updatedTask) return res.status(404).json({ error: 'Parent comment not found' });

            return res.status(200).json({ success: true, message: 'Reply added successfully', comments: updatedTask.comments });
        }

        // ✅ ADD FUNCTIONALITY: If adding a new comment
        if (comment) {
            const commentData = {
                ...comment,
                replies: [],
                fileName: comment.fileName || null, // Store file name if available
                fileSize: comment.fileSize || null, // Store file size if available
            };

            const result = await tasks.updateOne(
                { _id: taskObjectId },
                { $push: { comments: commentData } }
            );

            if (result.modifiedCount === 0) return res.status(500).json({ error: 'Failed to add comment' });

            return res.status(200).json({ success: true, message: 'Comment added successfully' });
        }

        return res.status(400).json({ error: 'Invalid request' });

    } catch (error) {
        console.error('Error updating comments:', error);
        res.status(500).json({ error: 'Failed to update comments' });
    }
});


router.put('/attachment/:taskId', async (req, res) => {
    const { client } = req;
    const { taskId } = req.params;
    const { attachments } = req.body; // Expecting full updated attachments array

    if (!taskId) return res.status(400).json({ error: 'Task ID is required' });
    if (!Array.isArray(attachments)) return res.status(400).json({ error: 'Attachments should be an array' });

    try {
        const { tasks } = await getCollections(client);
        const taskObjectId = safeObjectId(taskId);

        // Find and update task with new attachments array
        const updatedTask = await tasks.findOneAndUpdate(
            { _id: taskObjectId },
            { $set: { attachments } }, // Overwrite attachments with updated array
            { returnDocument: 'after' }
        );

        if (!updatedTask) return res.status(500).json({ error: 'Failed to update attachments' });

        return res.status(200).json({ success: true, message: 'Attachments updated successfully', attachments: updatedTask.attachments });

    } catch (error) {
        console.error('Error updating attachments:', error);
        res.status(500).json({ error: 'Failed to update attachments' });
    }
});

// 📌 Add Category to Project (✅ NEW ENDPOINT)
router.post('/category', async (req, res) => {
    const { client } = req;
    const { projectId, name, order } = req.body;

    if (!projectId || !name) {
        return res.status(400).json({ error: 'Project ID and Category name are required' });
    }

    try {
        const { projects } = await getCollections(client);

        // Fetch the project to get current categories
        const project = await projects.findOne({ _id: safeObjectId(projectId) });
        if (!project) return res.status(404).json({ error: 'Project not found' });

        let newOrder = order;

        // If order is not provided, find the highest existing order and increment
        if (order === undefined) {
            const currentCategories = project.categories || [];
            const highestOrder = currentCategories.reduce((max, category) =>
                category.order !== undefined ? Math.max(max, category.order) : max, 0
            );
            newOrder = highestOrder + 1;
        }

        const newCategory = {
            id: Date.now().toString(),
            name,
            order: newOrder, // Assign calculated order
        };

        await projects.updateOne(
            { _id: safeObjectId(projectId) },
            { $push: { categories: newCategory } }
        );

        res.status(201).json({ success: true, categoryId: newCategory.id, newOrder });
    } catch (error) {
        console.error('Error adding category:', error);
        res.status(500).json({ error: 'Failed to add category' });
    }
});

router.put('/category/:projectId/:categoryId', async (req, res) => {
    const { client } = req;
    const { projectId, categoryId } = req.params;
    const { name, order } = req.body;

    if (!name && order === undefined) {
        return res.status(400).json({ error: 'At least one field (name or order) is required' });
    }

    try {
        const { projects } = await getCollections(client);

        // Fetch the project to get current categories
        const project = await projects.findOne({ _id: safeObjectId(projectId) });
        if (!project) return res.status(404).json({ error: 'Project not found' });

        let newOrder = order;

        // If order is not provided, keep the current order
        if (order === undefined) {
            const category = project.categories.find(cat => cat.id === categoryId);
            if (!category) return res.status(404).json({ error: 'Category not found' });
            newOrder = category.order;
        }

        const updateFields = {};
        if (name) updateFields['categories.$.name'] = name;
        if (newOrder !== undefined) updateFields['categories.$.order'] = newOrder;

        const result = await projects.updateOne(
            { _id: safeObjectId(projectId), "categories.id": categoryId },
            { $set: updateFields }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ error: 'Category not found or no changes made' });
        }

        res.status(200).json({ success: true, message: 'Category updated successfully', newOrder });
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).json({ error: 'Failed to update category' });
    }
});

router.delete('/category/:projectId/:categoryId', async (req, res) => {
    const { client } = req;
    const { projectId, categoryId } = req.params;

    try {
        const { projects } = await getCollections(client);
        const result = await projects.updateOne(
            { _id: safeObjectId(projectId) },
            { $pull: { categories: { id: categoryId } } }
        );

        if (result.modifiedCount === 0) return res.status(404).json({ error: 'Category not found' });

        res.status(200).json({ success: true, message: 'Category deleted successfully' });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ error: 'Failed to delete category' });
    }
});


// 📌 Get Categories by Project (NEW ENDPOINT)
router.get('/categories/:projectId', async (req, res) => {
    const { client } = req;
    const { projectId } = req.params;

    try {
        const { projects } = await getCollections(client);

        // Find the project and retrieve only the categories field
        const project = await projects.findOne(
            { _id: safeObjectId(projectId) }, 
            { projection: { categories: 1 } } // Fetch only categories
        );

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.status(200).json({ success: true, data: project.categories || [] });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});


// 📌 Add Status to Project (✅ NEW ENDPOINT)
router.post('/status', async (req, res) => {
    const { client } = req;
    const { projectId, name, color, order } = req.body;

    if (!projectId || !name) {
        return res.status(400).json({ error: 'Project ID and Status name are required' });
    }

    try {
        const { projects } = await getCollections(client);

        // Fetch the project to get current statuses
        const project = await projects.findOne({ _id: safeObjectId(projectId) });
        if (!project) return res.status(404).json({ error: 'Project not found' });

        let newOrder = order;

        // If order is not provided, find the highest existing order and increment
        if (order === undefined) {
            const currentStatuses = project.statuses || [];
            const highestOrder = currentStatuses.reduce((max, status) => 
                status.order !== undefined ? Math.max(max, status.order) : max, 0
            );
            newOrder = highestOrder + 1;
        }

        const newStatus = {
            id: Date.now().toString(),
            name,
            color,
            order: newOrder, // Assign calculated order
        };

        await projects.updateOne(
            { _id: safeObjectId(projectId) },
            { $push: { statuses: newStatus } }
        );

        res.status(201).json({ success: true, statusId: newStatus.id, newOrder });
    } catch (error) {
        console.error('Error adding status:', error);
        res.status(500).json({ error: 'Failed to add status' });
    }
});

router.put('/status/:projectId/:statusId', async (req, res) => {
    const { client } = req;
    const { projectId, statusId } = req.params;
    const { name, color, order } = req.body;

    if (!name && !color && order === undefined) {
        return res.status(400).json({ error: 'At least one field (name, color, or order) is required' });
    }

    try {
        const { projects } = await getCollections(client);
        
        // Fetch the project to get current statuses
        const project = await projects.findOne({ _id: safeObjectId(projectId) });
        if (!project) return res.status(404).json({ error: 'Project not found' });

        let newOrder = order;

        // If order is not provided, auto-increment it based on the highest existing order
        if (order === undefined) {
            const currentStatuses = project.statuses || [];
            const highestOrder = currentStatuses.reduce((max, status) => 
                status.order !== undefined ? Math.max(max, status.order) : max, 0
            );
            newOrder = highestOrder + 1;
        }

        // Update fields dynamically
        const updateFields = {};
        if (name) updateFields['statuses.$.name'] = name;
        if (color) updateFields['statuses.$.color'] = color;
        if (newOrder !== undefined) updateFields['statuses.$.order'] = newOrder;

        const result = await projects.updateOne(
            { _id: safeObjectId(projectId), "statuses.id": statusId },
            { $set: updateFields }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ error: 'Status not found or no changes made' });
        }

        res.status(200).json({ success: true, message: 'Status updated successfully', newOrder });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

router.delete('/status/:projectId/:statusId', async (req, res) => {
    const { client } = req;
    const { projectId, statusId } = req.params;

    try {
        const { projects } = await getCollections(client);

        const result = await projects.updateOne(
            { _id: safeObjectId(projectId) },
            { $pull: { statuses: { id: statusId } } }
        );

        if (result.modifiedCount === 0) return res.status(404).json({ error: 'Status not found' });

        res.status(200).json({ success: true, message: 'Status deleted successfully' });
    } catch (error) {
        console.error('Error deleting status:', error);
        res.status(500).json({ error: 'Failed to delete status' });
    }
});

// 📌 Get Statuses by Project (NEW ENDPOINT)
router.get('/statuses/:projectId', async (req, res) => {
    const { client } = req;
    const { projectId } = req.params;

    try {
        const { projects } = await getCollections(client);

        // Find the project and retrieve only the statuses field
        const project = await projects.findOne(
            { _id: safeObjectId(projectId) }, 
            { projection: { statuses: 1 } } // Fetch only statuses
        );

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.status(200).json({ success: true, data: project.statuses || [] });
    } catch (error) {
        console.error('Error fetching statuses:', error);
        res.status(500).json({ error: 'Failed to fetch statuses' });
    }
});

// 📌 Set Status Done
router.put('/status/done/:projectId/:statusId', async (req, res) => {
    const { client } = req;
    const { projectId, statusId } = req.params;

    try {
        const { projects } = await getCollections(client);
        
        // Ensure the status isn't already cancelled
        const project = await projects.findOne(
            { _id: safeObjectId(projectId), "statuses.id": statusId },
            { projection: { "statuses.$": 1 } }
        );

        if (project && project.statuses[0].isCancelled) {
            return res.status(400).json({ error: 'Cannot set done because status is already cancelled' });
        }

        // Set the selected status to done
        const result = await projects.updateOne(
            { _id: safeObjectId(projectId), "statuses.id": statusId },
            { $set: { "statuses.$.isDone": true, "statuses.$.isCancelled": false } }
        );

        if (result.modifiedCount === 0) return res.status(404).json({ error: 'Status not found or no changes made' });

        res.status(200).json({ success: true, message: 'Status set to done successfully' });
    } catch (error) {
        console.error('Error setting status to done:', error);
        res.status(500).json({ error: 'Failed to set status to done' });
    }
});

// 📌 Set Status Cancelled
router.put('/status/cancel/:projectId/:statusId', async (req, res) => {
    const { client } = req;
    const { projectId, statusId } = req.params;

    try {
        const { projects } = await getCollections(client);
        
        // Ensure the status isn't already marked as done
        const project = await projects.findOne(
            { _id: safeObjectId(projectId), "statuses.id": statusId },
            { projection: { "statuses.$": 1 } }
        );

        if (project && project.statuses[0].isDone) {
            return res.status(400).json({ error: 'Cannot set cancelled because status is already done' });
        }

        // Set the selected status to cancelled
        const result = await projects.updateOne(
            { _id: safeObjectId(projectId), "statuses.id": statusId },
            { $set: { "statuses.$.isCancelled": true, "statuses.$.isDone": false } }
        );

        if (result.modifiedCount === 0) return res.status(404).json({ error: 'Status not found or no changes made' });

        res.status(200).json({ success: true, message: 'Status set to cancelled successfully' });
    } catch (error) {
        console.error('Error setting status to cancelled:', error);
        res.status(500).json({ error: 'Failed to set status to cancelled' });
    }
});

module.exports = router;
