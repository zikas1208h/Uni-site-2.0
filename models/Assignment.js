const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
  },
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  // How students should submit
  submissionType: {
    type: String,
    enum: ['link', 'email', 'upload', 'inclass', 'other', 'none'],
    default: 'link',
  },
  submissionDetails: { type: String, default: '' },
  submissionLink:    { type: String, default: '' },

  // For exam/quiz announcements
  examType:      { type: String, enum: ['quiz','midterm','final','none'], default: 'none' },
  materialsCovered: { type: String, default: '' },  // what topics/materials will be covered
  examDuration:  { type: Number, default: null },   // minutes
  examLocation:  { type: String, default: '' },
  isAnnouncement:{ type: Boolean, default: false }, // true = exam/quiz announcement only
  // Links this assignment/exam to a grade component slot (set when graded)
  gradeComponentId: { type: String, default: null },
  // Per-student scores: { studentId: { score, gradedAt, gradedBy } }
  studentScores: {
    type: Map,
    of: new mongoose.Schema({
      score:    { type: Number, default: null },
      gradedAt: { type: Date,   default: null },
      gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    }, { _id: false }),
    default: {},
  }, // matches component name+type key
  // Optional attached file (stored as base64 like materials)
  fileName: { type: String, default: '' },
  filePath: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  fileData: { type: String, default: '' },      // base64
  fileMimeType: { type: String, default: '' },

  deadline: { type: Date, required: true },
  totalMarks: { type: Number, default: 100 },
  uploadedBy: { type: mongoose.Schema.Types.Mixed },  // ObjectId or string
  semester: { type: String, default: 'Spring' },
  year: { type: Number, default: new Date().getFullYear() },
}, { timestamps: true });

assignmentSchema.index({ course: 1 });
assignmentSchema.index({ deadline: 1 });
assignmentSchema.index({ createdAt: -1 });
assignmentSchema.index({ course: 1, createdAt: -1 });

module.exports = mongoose.model('Assignment', assignmentSchema);

