const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  assignment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    required: true,
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
  },
  // Uploaded file (stored as base64)
  fileName:    { type: String, required: true },
  fileSize:    { type: Number, default: 0 },
  fileData:    { type: String, required: true },   // base64
  fileMimeType:{ type: String, default: 'application/pdf' },

  // Staff feedback (optional)
  feedback:    { type: String, default: '' },
  marks:       { type: Number, default: null },
  status:      { type: String, enum: ['submitted', 'reviewed', 'graded'], default: 'submitted' },

  submittedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// One submission per student per assignment
submissionSchema.index({ assignment: 1, student: 1 }, { unique: true });
submissionSchema.index({ assignment: 1 });
submissionSchema.index({ student: 1 });
submissionSchema.index({ course: 1 });

module.exports = mongoose.model('Submission', submissionSchema);

