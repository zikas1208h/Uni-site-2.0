const mongoose = require('mongoose');

// ── Letter grade scale ────────────────────────────────────────────────────────
const calcLetterGradeFromTotal = (total) => {
  if (total >= 96) return { grade: 'A+', gradePoint: 4.0 };
  if (total >= 92) return { grade: 'A',  gradePoint: 3.7 };
  if (total >= 88) return { grade: 'A-', gradePoint: 3.4 };
  if (total >= 84) return { grade: 'B+', gradePoint: 3.2 };
  if (total >= 80) return { grade: 'B',  gradePoint: 3.0 };
  if (total >= 76) return { grade: 'B-', gradePoint: 2.8 };
  if (total >= 72) return { grade: 'C+', gradePoint: 2.6 };
  if (total >= 68) return { grade: 'C',  gradePoint: 2.4 };
  if (total >= 64) return { grade: 'C-', gradePoint: 2.2 };
  if (total >= 60) return { grade: 'D+', gradePoint: 2.0 };
  if (total >= 55) return { grade: 'D',  gradePoint: 1.5 };
  if (total >= 50) return { grade: 'D-', gradePoint: 1.0 };
  return               { grade: 'F',  gradePoint: 0.0 };
};
const RETAKE_MAX_SCORE = 83;
const applyRetakeCap = (total) => calcLetterGradeFromTotal(Math.min(total ?? 0, RETAKE_MAX_SCORE));

// ── Classwork entry ───────────────────────────────────────────────────────────
// Types: quiz | assignment | midterm  — raw marks ONLY, zero GPA effect ever.
// Auto-added when an assignment/quiz/midterm is created (or manually added for offline ones).
// Once graded → locked (isGraded=true). Can only be edited after that.
const classworkEntrySchema = new mongoose.Schema({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', default: null },
  name:         { type: String, required: true },
  type:         { type: String, enum: ['quiz', 'assignment', 'midterm', 'other'], default: 'assignment' },
  maxScore:     { type: Number, min: 1, default: 100 },
  score:        { type: Number, min: 0, default: null },   // null = not yet graded
  isGraded:     { type: Boolean, default: false },
  gradedAt:     { type: Date, default: null },
  gradedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

// ── Semester grade ────────────────────────────────────────────────────────────
// Contains: Final Exam score + (optional) Practical Exam score.
// GPA/CGPA only updates when finalScore is set (isFinalized = true).
// Practical is part of semester grade for courses that have it.
const semesterGradeSchema = new mongoose.Schema({
  // Final exam
  finalScore:      { type: Number, min: 0, default: null },
  finalMaxScore:   { type: Number, min: 1, default: 100 },
  // Practical exam (only for hasPractical courses) — counts toward total
  practicalScore:    { type: Number, min: 0, default: null },
  practicalMaxScore: { type: Number, min: 1, default: 100 },

  // Derived fields — computed by pre-save hook
  totalScore:   { type: Number, default: null },   // out of 100, capped
  grade:        { type: String, default: null },
  gradePoint:   { type: Number, default: null },
  isFinalized:  { type: Boolean, default: false },  // true when finalScore is set
}, { _id: false });

// ── Main grade document ───────────────────────────────────────────────────────
const gradeSchema = new mongoose.Schema({
  student:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
  course:   { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  semester: { type: String, required: true },
  year:     { type: Number, required: true },

  // CLASSWORK: quizzes + assignments + midterm — raw scores, no letter grade, no GPA
  classwork: { type: [classworkEntrySchema], default: [] },

  // SEMESTER GRADE: final (+ practical if applicable) — triggers GPA when final is graded
  semesterGrade: { type: semesterGradeSchema, default: () => ({}) },

  // Retake
  isRetake:      { type: Boolean, default: false },
  previousGrade: { type: String,  default: null },
  retakeAttempt: { type: Number,  default: 1 },
}, { timestamps: true });

// ── Pre-save: compute semester grade totals ───────────────────────────────────
gradeSchema.pre('save', function (next) {
  const sg = this.semesterGrade;
  if (!sg) return next();

  const hasFinal     = sg.finalScore     != null;
  const hasPractical = sg.practicalScore != null;

  if (!hasFinal && !hasPractical) {
    sg.totalScore  = null;
    sg.grade       = null;
    sg.gradePoint  = null;
    sg.isFinalized = false;
    return next();
  }

  // Normalize each component to percentage of its max, then weight:
  //   If course has practical:  final = 60%, practical = 40%  (both required for full grade)
  //   If no practical:          final = 100%
  // Either way the total is capped at 100.
  let total;
  if (hasPractical && hasFinal) {
    const finalPct    = (sg.finalScore    / Math.max(sg.finalMaxScore,    1)) * 60;
    const practPct    = (sg.practicalScore / Math.max(sg.practicalMaxScore, 1)) * 40;
    total = Math.min(parseFloat((finalPct + practPct).toFixed(2)), 100);
  } else if (hasFinal) {
    // Only final graded so far — show running total but don't finalize until all components in
    const finalPct = (sg.finalScore / Math.max(sg.finalMaxScore, 1)) * 100;
    total = Math.min(parseFloat(finalPct.toFixed(2)), 100);
  } else {
    // Only practical, no final yet — running partial
    const practPct = (sg.practicalScore / Math.max(sg.practicalMaxScore, 1)) * 100;
    total = Math.min(parseFloat(practPct.toFixed(2)), 100);
  }

  sg.totalScore  = total;
  sg.isFinalized = hasFinal; // GPA updates ONLY when final is graded

  if (sg.isFinalized) {
    const result = this.isRetake ? applyRetakeCap(total) : calcLetterGradeFromTotal(total);
    sg.grade      = result.grade;
    sg.gradePoint = result.gradePoint;
  } else {
    sg.grade      = null;
    sg.gradePoint = null;
  }
  next();
});

gradeSchema.index({ student: 1 });
gradeSchema.index({ course: 1 });
gradeSchema.index({ student: 1, course: 1 }, { unique: true });
gradeSchema.index({ semester: 1, year: -1 });
gradeSchema.index({ student: 1, semester: 1, year: 1 });

module.exports = mongoose.model('Grade', gradeSchema);
module.exports.calcLetterGradeFromTotal = calcLetterGradeFromTotal;
module.exports.applyRetakeCap           = applyRetakeCap;
module.exports.RETAKE_MAX_SCORE         = RETAKE_MAX_SCORE;
