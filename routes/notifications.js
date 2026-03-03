const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { auth } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');

// â”€â”€ GET /notifications  â€” current user's notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.userId })
      .populate('course', 'courseCode courseName')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const unreadCount = await Notification.countDocuments({ recipient: req.userId, isRead: false });
    res.json({ notifications, unreadCount });
  } catch (e) {
    return sendError(res, 500, 'Error fetching notifications', e);
  }
});

// â”€â”€ GET /notifications/unread-count  â€” fast badge count â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/unread-count', auth, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ recipient: req.userId, isRead: false });
    res.json({ count });
  } catch (e) {
    return sendError(res, 500, 'Error fetching notification count', e);
  }
});

// â”€â”€ PATCH /notifications/read-all  â€” mark all as read (must be BEFORE /:id/read) â”€â”€
router.patch('/read-all', auth, async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.userId, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (e) {
    return sendError(res, 500, 'Error marking all as read', e);
  }
});

// â”€â”€ PATCH /notifications/:id/read  â€” mark one as read â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.patch('/:id/read', auth, async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.userId },
      { isRead: true }
    );
    res.json({ success: true });
  } catch (e) {
    return sendError(res, 500, 'Error marking notification as read', e);
  }
});


// â”€â”€ DELETE /notifications/:id  â€” delete one â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/:id', auth, async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.userId });
    res.json({ success: true });
  } catch (e) {
    return sendError(res, 500, 'Error deleting notification', e);
  }
});

module.exports = router;
