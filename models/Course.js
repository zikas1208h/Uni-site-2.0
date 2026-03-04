const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  courseCode: {
    type: String,
    required: true,
    unique: true
  },
  courseName: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  credits: {
    type: Number,
    required: true
  },
  instructor: {
    type: String,
    required: true
  },
  major: {
    type: String,
    default: 'Shared'
  },
  prerequisites: [{
    type: String,
    default: []
  }],
  semester: {
    type: String,
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  schedule: {
    days: [String],
    time: String
  },
  enrolledStudents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  status: {
    type: String,
    enum: ['active', 'completed'],
    default: 'active'
  },
  // ── Schedule staff assignment ──────────────────────────────────────────────
  scheduleDoctors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: [],
  }],
  scheduleAssistants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: [],
  }],
  // Some courses have a practical/lab exam component
  hasPractical: { type: Boolean, default: false },
}, {
  timestamps: true
});

// Indexes for performance
courseSchema.index({ courseCode: 1 });
courseSchema.index({ semester: 1, year: -1 });
courseSchema.index({ instructor: 1 });
courseSchema.index({ credits: 1 });

// Compound indexes
courseSchema.index({ semester: 1, year: 1 });

// Virtual for enrolled count
courseSchema.virtual('enrolledCount').get(function() {
  return this.enrolledStudents?.length || 0;
});

courseSchema.set('toJSON', { virtuals: true });
courseSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Course', courseSchema);

