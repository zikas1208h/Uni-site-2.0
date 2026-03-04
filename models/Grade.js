const mongoose = require('mongoose');

// ── Exam component schema ──────────────────────────────────────────────────────
const examComponentSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  type:      { type: String, enum: ['quiz','midterm','final','assignment','other'], default: 'quiz' },
  score:     { type: Number, min: 0, default: null },
  maxScore:  { type: Number, min: 1, default: 100 },
  weight:    { type: Number, min: 0, max: 100, default: null },
  isFinal:   { type: Boolean, default: false }, // marks this as the Final Exam component
}, { _id: false });

// DEFINED FIRST — used by both calcLetterGrade and pre-save hook
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

const calcLetterGrade = (quiz, assignment, final) => {
  const total = (quiz * 0.20) + (assignment * 0.20) + (final * 0.60);
  return calcLetterGradeFromTotal(total);
};

const calcFromComponents = (components) => {
  if (!components || !components.length) return null;
  const filled = components.filter(c => c.score != null && c.maxScore > 0 && c.weight != null);
  if (!filled.length) return null;
  const totalWeight = filled.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return null;
  const weighted = filled.reduce((s, c) => s + (c.score / c.maxScore) * c.weight, 0);
  return (weighted / totalWeight) * 100;
};

const RETAKE_MAX_SCORE = 83;
const applyRetakeCap = (grade, gradePoint, total) => {
  const cappedTotal = Math.min(total != null ? total : Infinity, RETAKE_MAX_SCORE);
  const result = calcLetterGradeFromTotal(cappedTotal);
  return { grade: result.grade, gradePoint: result.gradePoint, cappedTotal };
};

const gradeSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course:  { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },

  // ── Legacy simple scores (each out of 100) ──────────────────────────────────
  quizScore:       { type: Number, min: 0, max: 100, default: null },
  assignmentScore: { type: Number, min: 0, max: 100, default: null },
  finalScore:      { type: Number, min: 0, max: 100, default: null },

  // ── NEW: structured exam components ─────────────────────────────────────────
  components: { type: [examComponentSchema], default: [] },

  // ── Derived / manually-set grade ────────────────────────────────────────────
  grade:      { type: String, required: true, enum: ['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F'] },
  gradePoint: { type: Number, required: true },

  // ── Finalization — GPA only counts when this is true ───────────────────────
  // Set to true automatically when a 'final' type component is graded,
  // or when using legacy scores (finalScore present), or manual grade entry.
  isFinalized: { type: Boolean, default: false },

  // ── Retake tracking ──────────────────────────────────────────────────────────
  isRetake:       { type: Boolean, default: false },  // true = student previously got F
  previousGrade:  { type: String, default: null },    // the F grade from previous attempt
  retakeAttempt:  { type: Number, default: 1 },       // which retake attempt (1, 2, ...)

  semester: { type: String, required: true },
  year:     { type: Number, required: true },
}, { timestamps: true });

// ── Auto-calculate grade + set isFinalized ────────────────────────────────────
gradeSchema.pre('save', function (next) {
  // Determine finalization:
  // 1. Components mode: finalized only if a 'final' or 'isFinal' component has a score
  // 2. Legacy scores: finalized only if finalScore is present
  // 3. Manual: always finalized

  const fromComp = calcFromComponents(this.components);
  if (fromComp != null) {
    const hasFinalComp = this.components.some(
      c => (c.type === 'final' || c.isFinal === true) && c.score != null
    );
    this.isFinalized = hasFinalComp;
    const g = calcLetterGradeFromTotal(fromComp);
    this.grade = g.grade;
    this.gradePoint = g.gradePoint;
    return next();
  }

  const q = this.quizScore, a = this.assignmentScore, f = this.finalScore;
  if (q != null && a != null && f != null) {
    this.isFinalized = true; // legacy scores always have final
    const { grade, gradePoint } = calcLetterGrade(q, a, f);
    this.grade = grade; this.gradePoint = gradePoint;
    return next();
  }

  // Manual grade: always finalized
  this.isFinalized = true;
  next();
});

// Indexes
gradeSchema.index({ student: 1 });
gradeSchema.index({ course: 1 });
gradeSchema.index({ semester: 1, year: -1 });
gradeSchema.index({ student: 1, course: 1 }, { unique: true });
gradeSchema.index({ student: 1, semester: 1, year: 1 });

module.exports = mongoose.model('Grade', gradeSchema);
module.exports.calcLetterGrade = calcLetterGrade;
module.exports.calcLetterGradeFromTotal = calcLetterGradeFromTotal;
module.exports.calcFromComponents = calcFromComponents;
module.exports.applyRetakeCap = applyRetakeCap;
module.exports.RETAKE_MAX_SCORE = RETAKE_MAX_SCORE;
