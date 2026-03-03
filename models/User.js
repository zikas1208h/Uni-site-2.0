const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  studentId: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: true
  },
  major: {
    type: String,
    required: true
  },
  department: {
    type: String,
    default: 'Computer Science'
  },
  semester: {
    type: String,
    default: 'Spring'
  },
  academicYear: {
    type: Number,
    default: 2026
  },
  lectureGroup: {
    type: Number,   // 1–6  (the lecture group)
    default: null
  },
  section: {
    type: Number,   // 1 or 2  (the sub-section for practicals)
    default: null
  },
  year: {
    type: Number,
    required: true
  },
  role: {
    type: String,
    enum: ['student', 'admin', 'superadmin', 'doctor', 'assistant'],
    default: 'student'
  },
  // Courses a doctor/assistant is responsible for
  assignedCourses: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course'
  }],
  // Assistant: doctors this assistant is linked to (live link — courses auto-sync)
  linkedDoctors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Assistant: extra courses assigned on top of what linked doctors have
  extraCourses: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course'
  }],
  // Granular feature permissions — superadmin can toggle per staff member
  permissions: {
    canManageGrades:    { type: Boolean, default: true  },
    canUploadMaterials: { type: Boolean, default: true  },
    canViewStudents:    { type: Boolean, default: true  },
    canViewAllStudents: { type: Boolean, default: false },
    canEditCourse:      { type: Boolean, default: true  },
    canMarkCourseStatus:{ type: Boolean, default: true  },
    canResetPasswords:  { type: Boolean, default: false },
    canManageStudentEnrollment: { type: Boolean, default: false },
  },
  // Student's enrolled courses
  enrolledCourses: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course'
  }],
  profilePicture: {
    type: String,
    default: null
  },
  // First-login credential setup flow for staff
  mustChangeCredentials: {
    type: Boolean,
    default: false,
  },
  otp:       { type: String,  default: null },
  otpExpiry: { type: Date,    default: null },
}, {
  timestamps: true
});

// ── Indexes for fast lookups ──────────────────────────────────────────────
userSchema.index({ role: 1 });
userSchema.index({ studentId: 1 });
userSchema.index({ email: 1 });
userSchema.index({ role: 1, major: 1 });
userSchema.index({ enrolledCourses: 1 });

// Virtual full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Helper virtual: is any kind of admin
userSchema.virtual('isAnyAdmin').get(function() {
  return ['admin', 'superadmin', 'doctor', 'assistant'].includes(this.role);
});

userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('User', userSchema);
