const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['Lecture', 'Section', 'Video', 'Extra', 'lecture', 'assignment', 'reading', 'video', 'other'],
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number
  },
  fileUrl: {
    type: String
  },
  fileData: {
    type: String  // base64 encoded file content
  },
  fileMimeType: {
    type: String
  },
  uploadedBy: {
    type: mongoose.Schema.Types.Mixed  // supports both string and ObjectId
  }
}, {
  timestamps: true
});

// Indexes for performance
materialSchema.index({ course: 1 });
materialSchema.index({ type: 1 });
materialSchema.index({ createdAt: -1 });

// Compound indexes
materialSchema.index({ course: 1, type: 1 });
materialSchema.index({ course: 1, createdAt: -1 });

module.exports = mongoose.model('Material', materialSchema);

