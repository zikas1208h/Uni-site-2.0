const express = require('express');
const router = express.Router();
const Grade = require('../models/Grade');
const Course = require('../models/Course');
const User = require('../models/User');
const { auth, isAdmin, requireSuperAdmin, isSuperAdmin, getEffectiveCourseIds } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');

// â”€â”€â”€ Helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const extractId = (c) => (c._id || c).toString();


// Uses req.user already populated by auth middleware â€” no extra DB call
const canAccessCourse = (req, courseId) => {
  if (isSuperAdmin(req.user)) return true;
  const ids = getEffectiveCourseIds(req.user).map(id => id.toString());
  return ids.includes(courseId?.toString());
};

// â”€â”€ Grade statistics (superadmin only â€” all courses) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/statistics', auth, requireSuperAdmin, async (req, res) => {
  try {
    // Exclude ungraded retake placeholders from averages
    const skipRetakes = { $nor: [{ isRetake: true, gradePoint: 0, grade: 'F' }] };

    const courseStats = await Grade.aggregate([
      { $match: skipRetakes },
      { $group: { _id: '$course', averageGradePoint: { $avg: '$gradePoint' }, totalStudents: { $sum: 1 }, grades: { $push: '$grade' } } },
      { $lookup: { from: 'courses', localField: '_id', foreignField: '_id', as: 'courseInfo' } },
      { $unwind: '$courseInfo' },
      { $project: { courseCode: '$courseInfo.courseCode', courseName: '$courseInfo.courseName', averageGradePoint: 1, averageGrade: { $round: ['$averageGradePoint', 2] }, totalStudents: 1, grades: 1 } },
      { $sort: { 'courseInfo.courseCode': 1 } }
    ]);

    const majorStats = await Grade.aggregate([
      { $match: skipRetakes },
      { $lookup: { from: 'users', localField: 'student', foreignField: '_id', as: 'studentInfo' } },
      { $unwind: '$studentInfo' },
      { $group: { _id: '$studentInfo.major', averageGradePoint: { $avg: '$gradePoint' }, totalStudents: { $addToSet: '$student' }, totalGrades: { $sum: 1 } } },
      { $project: { major: '$_id', averageGradePoint: { $round: ['$averageGradePoint', 2] }, totalStudents: { $size: '$totalStudents' }, totalGrades: 1 } },
      { $sort: { major: 1 } }
    ]);

    res.json({ courseStatistics: courseStats, majorStatistics: majorStats });
  } catch (error) {
    return sendError(res, 500, 'Error fetching statistics', error);
  }
});

// â”€â”€ Grade statistics for assigned courses (doctor / assistant / superadmin) â”€â”€â”€
router.get('/statistics/my-courses', auth, isAdmin, async (req, res) => {
  try {
    // Use already-populated req.user â€” no extra DB round-trip needed
    let scopedCourseIds = null; // null = superadmin, sees all
    if (!isSuperAdmin(req.user)) {
      scopedCourseIds = getEffectiveCourseIds(req.user);
      if (scopedCourseIds.length === 0) {
        return res.json({ courseStatistics: [], majorStatistics: [], gradeDistribution: [] });
      }
    }

    const courseFilter = scopedCourseIds ? { course: { $in: scopedCourseIds } } : {};

    // Exclude ungraded retake placeholders from all stats
    const excludeUngradedRetakes = { $nor: [{ isRetake: true, gradePoint: 0, grade: 'F' }] };
    const effectiveCourseFilter  = scopedCourseIds
      ? { course: { $in: scopedCourseIds }, ...excludeUngradedRetakes }
      : excludeUngradedRetakes;

    // â”€â”€ Get all assigned courses (even those with 0 grades) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const courseQuery = scopedCourseIds ? { _id: { $in: scopedCourseIds } } : {};
    const allCourses = await Course.find(courseQuery)
      .select('_id courseCode courseName major year semester status')
      .lean();

    // â”€â”€ Get grade aggregates for courses that HAVE grades â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const gradeAggRaw = await Grade.aggregate([
      { $match: effectiveCourseFilter },
      { $group: {
          _id: '$course',
          averageGradePoint: { $avg: '$gradePoint' },
          totalStudents:     { $sum: 1 },
          grades:            { $push: '$grade' },
          passCount: { $sum: { $cond: [{ $gte: ['$gradePoint', 1.0] }, 1, 0] } },
          failCount: { $sum: { $cond: [{ $lt:  ['$gradePoint', 1.0] }, 1, 0] } },
        }
      }
    ]);

    // Map grade agg by courseId string for easy lookup
    const gradeMap = new Map(gradeAggRaw.map(g => [g._id.toString(), g]));

    // â”€â”€ Merge: every course gets a stats row, zero-filled if no grades â”€â”€â”€â”€â”€â”€â”€â”€
    const courseStats = allCourses.map(c => {
      const g = gradeMap.get(c._id.toString());
      return {
        _id:              c._id,
        courseCode:       c.courseCode,
        courseName:       c.courseName,
        major:            c.major,
        year:             c.year,
        semester:         c.semester,
        averageGradePoint: g ? parseFloat(g.averageGradePoint.toFixed(2)) : 0,
        totalStudents:    g ? g.totalStudents : 0,
        passCount:        g ? g.passCount     : 0,
        failCount:        g ? g.failCount     : 0,
        grades:           g ? g.grades        : [],
      };
    }).sort((a, b) => (a.courseCode || '').localeCompare(b.courseCode || ''));

    // â”€â”€ Grade distribution across all scoped courses â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const gradeDist = await Grade.aggregate([
      { $match: effectiveCourseFilter },
      { $group: { _id: '$grade', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // â”€â”€ Per-major stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const majorStats = await Grade.aggregate([
      { $match: effectiveCourseFilter },
      { $lookup: { from: 'users', localField: 'student', foreignField: '_id', as: 'studentInfo' } },
      { $unwind: '$studentInfo' },
      { $group: {
          _id: '$studentInfo.major',
          averageGradePoint: { $avg: '$gradePoint' },
          totalStudents: { $addToSet: '$student' },
          totalGrades:   { $sum: 1 },
        }
      },
      { $project: {
          major: '$_id',
          averageGradePoint: { $round: ['$averageGradePoint', 2] },
          totalStudents: { $size: '$totalStudents' },
          totalGrades: 1,
        }
      },
      { $sort: { major: 1 } }
    ]);

    res.json({
      courseStatistics:  courseStats,
      majorStatistics:   majorStats,
      gradeDistribution: gradeDist,
    });
  } catch (error) {
    return sendError(res, 500, 'Error fetching statistics', error);
  }
});

// â”€â”€ Student's own grades â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/student', auth, async (req, res) => {
  try {
    const grades = await Grade.find({ student: req.userId })
      .populate('course', 'courseCode courseName credits')
      .sort({ year: -1, semester: 1 })
      .lean();
    // For retake records: the F has been replaced by the new grade already.
    // isRetake=true just means the student previously failed â€” the grade shown IS the new one.
    res.json(grades);
  } catch (error) {
    return sendError(res, 500, 'Error fetching grades', error);
  }
});

// â”€â”€ Calculate GPA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Skip: (1) records with no credits, (2) ungraded retake placeholders (isRetake=true, grade still F/0)
router.get('/gpa', auth, async (req, res) => {
  try {
    const grades = await Grade.find({ student: req.userId }).populate('course', 'credits').lean();
    if (grades.length === 0) return res.json({ gpa: 0, totalCredits: 0 });
    let totalPoints = 0, totalCredits = 0;
    grades.forEach(g => {
      // Skip courses with no credits
      if (!g.course?.credits) return;
      // Skip ungraded retake placeholders â€” re-enrolled but not yet graded
      if (g.isRetake && g.gradePoint === 0 && g.grade === 'F') return;
      totalPoints  += g.gradePoint * g.course.credits;
      totalCredits += g.course.credits;
    });
    if (totalCredits === 0) return res.json({ gpa: 0, totalCredits: 0 });
    res.json({ gpa: parseFloat((totalPoints / totalCredits).toFixed(2)), totalCredits });
  } catch (error) {
    return sendError(res, 500, 'Error calculating GPA', error);
  }
});

// â”€â”€ Grades by course â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/course/:courseId', auth, async (req, res) => {
  try {
    const grade = await Grade.findOne({ student: req.userId, course: req.params.courseId })
      .populate('course', 'courseCode courseName');
    if (!grade) return res.status(404).json({ message: 'Grade not found' });
    res.json(grade);
  } catch (error) {
    return sendError(res, 500, 'Error fetching grade', error);
  }
});

// â”€â”€ Add / Update grade (staff: doctor/assistant/superadmin) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/', auth, isAdmin, async (req, res) => {
  try {
    const {
      student, course, semester, year,
      quizScore, assignmentScore, finalScore,
      grade: manualGrade, gradePoint: manualGradePoint,
      components, // NEW: array of { name, type, score, maxScore, weight }
    } = req.body;

    if (!isSuperAdmin(req.user) && req.user.permissions?.canManageGrades === false) {
      return res.status(403).json({ message: 'You do not have permission to manage grades' });
    }
    if (!canAccessCourse(req, course)) {
      return res.status(403).json({ message: 'You do not have access to this course' });
    }

    const { calcLetterGrade, calcLetterGradeFromTotal, calcFromComponents, applyRetakeCap } = require('../models/Grade');
    let finalGrade, finalGradePoint, computedTotal;

    // Priority: components â†’ legacy scores â†’ manual
    const hasComponents = Array.isArray(components) && components.length > 0 &&
      components.some(c => c.score != null);
    const hasScores = quizScore != null && assignmentScore != null && finalScore != null;

    if (hasComponents) {
      const total = calcFromComponents(components);
      if (total != null) {
        computedTotal = total;
        const result = calcLetterGradeFromTotal(total);
        finalGrade = result.grade; finalGradePoint = result.gradePoint;
      } else {
        finalGrade = manualGrade; finalGradePoint = manualGradePoint;
      }
    } else if (hasScores) {
      const result = calcLetterGrade(Number(quizScore), Number(assignmentScore), Number(finalScore));
      finalGrade = result.grade; finalGradePoint = result.gradePoint;
      computedTotal = (Number(quizScore) * 0.20) + (Number(assignmentScore) * 0.20) + (Number(finalScore) * 0.60);
    } else {
      finalGrade = manualGrade; finalGradePoint = manualGradePoint;
    }

    if (!finalGrade) return res.status(400).json({ message: 'Grade or scores are required' });

    // â”€â”€ Check if this is a retake â€” apply cap if so â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let existingGrade = await Grade.findOne({ student, course });
    const isRetake = existingGrade?.isRetake === true;

    if (isRetake && computedTotal != null) {
      // Cap computed total at 83 and recalculate grade
      const capped = applyRetakeCap(finalGrade, finalGradePoint, computedTotal);
      finalGrade      = capped.grade;
      finalGradePoint = capped.gradePoint;
    } else if (isRetake && finalGrade) {
      // Manual grade entry for retake â€” cap gradePoint at B (3.0, corresponds to 83)
      const RETAKE_MAX_GP = 3.0; // B = max 83 marks
      if (finalGradePoint > RETAKE_MAX_GP) {
        finalGrade      = 'B';
        finalGradePoint = RETAKE_MAX_GP;
      }
    }
    if (existingGrade) {
      existingGrade.grade      = finalGrade;
      existingGrade.gradePoint = finalGradePoint;
      existingGrade.semester   = semester;
      existingGrade.year       = year;
      if (hasComponents) existingGrade.components = components;
      if (hasScores) {
        existingGrade.quizScore       = Number(quizScore);
        existingGrade.assignmentScore = Number(assignmentScore);
        existingGrade.finalScore      = Number(finalScore);
      }
      // For retakes: the F is fully replaced by the new (capped) grade.
      // Keep isRetake=true and previousGrade so the UI can show the retake badge,
      // but the grade field now holds the new earned grade (max B / 83).
      // previousGrade already set during re-enrollment; no change needed here.
      await existingGrade.save();
    } else {
      existingGrade = await Grade.create({
        student, course, semester, year,
        grade: finalGrade, gradePoint: finalGradePoint,
        quizScore:       hasScores ? Number(quizScore)       : null,
        assignmentScore: hasScores ? Number(assignmentScore) : null,
        finalScore:      hasScores ? Number(finalScore)      : null,
        components:      hasComponents ? components : [],
        isRetake: false,
      });
    }

    const response = existingGrade.toObject ? existingGrade.toObject() : existingGrade._doc || existingGrade;
    if (isRetake) {
      response._retakeCapped   = true;
      response._retakeMaxScore = 83;
    }

    // Auto-complete: remove student from course enrollment
    await User.findByIdAndUpdate(student, { $pull: { enrolledCourses: course } });
    await Course.findByIdAndUpdate(course, { $pull: { enrolledStudents: student } });

    const courseDoc = await Course.findById(course);
    if (courseDoc && courseDoc.enrolledStudents.length === 0) {
      courseDoc.status = 'completed';
      await courseDoc.save();
    }

    res.status(201).json(response);
  } catch (error) {
    return sendError(res, 500, 'Error adding grade', error);
  }
});

// â”€â”€ Delete grade (superadmin only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/:id', auth, requireSuperAdmin, async (req, res) => {
  try {
    const grade = await Grade.findByIdAndDelete(req.params.id);
    if (!grade) return res.status(404).json({ message: 'Grade not found' });
    res.json({ message: 'Grade deleted successfully' });
  } catch (error) {
    return sendError(res, 500, 'Error deleting grade', error);
  }
});

// â”€â”€ Get grades for a specific student (staff) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/admin/student/:studentId', auth, isAdmin, async (req, res) => {
  try {
    const grades = await Grade.find({ student: req.params.studentId })
      .populate('course', 'courseCode courseName credits')
      .sort({ year: -1, semester: 1 });

    const filteredGrades = isSuperAdmin(req.user)
      ? grades
      : grades.filter(g => canAccessCourse(req, (g.course?._id || g.course)));

    const cgpa = filteredGrades.length > 0
      ? parseFloat((filteredGrades.reduce((s, g) => s + g.gradePoint, 0) / filteredGrades.length).toFixed(2))
      : 0;

    res.json({ grades: filteredGrades, cgpa, totalGrades: filteredGrades.length });
  } catch (error) {
    return sendError(res, 500, 'Error fetching student grades', error);
  }
});

module.exports = router;
