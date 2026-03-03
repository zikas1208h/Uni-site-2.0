const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Who receives this notification
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['assignment', 'material', 'grade', 'announcement', 'exam'],
    required: true,
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  // Optional references
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', default: null },
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', default: null },
  isRead: { type: Boolean, default: false, index: true },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);

