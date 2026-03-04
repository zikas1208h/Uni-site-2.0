﻿const express = require('express');
const router = express.Router();
const Grade = require('../models/Grade');
const Course = require('../models/Course');
const User = require('../models/User');
const { auth, isAdmin, requireSuperAdmin, isSuperAdmin, getEffectiveCourseIds } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');

// أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬ Helper أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
const extractId = (c) => (c._id || c).toString();


// Uses req.user already populated by auth middleware أ¢â‚¬â€‌ no extra DB call
const canAccessCourse = (req, courseId) => {
  if (isSuperAdmin(req.user)) return true;
  const ids = getEffectiveCourseIds(req.user).map(id => id.toString());
  return ids.includes(courseId?.toString());
};

/**
 * isGradeFinalized(g)
 * Returns true if this grade should count toward CGPA.
 *
 * For NEW grades: uses the isFinalized field set by the pre-save hook.
 * For OLD grades (isFinalized === undefined, saved before this feature):
 *   - If it has components: finalized only if one has type 'final' with a score
 *   - If it has legacy finalScore: finalized
 *   - If it has no scores at all (manual grade entry): finalized
 *   - If it only has quiz/assignment scores but no finalScore/final-component: NOT finalized
 */
const isGradeFinalized = (g) => {
  // Explicitly set by pre-save hook
  if (g.isFinalized === true)  return true;
  if (g.isFinalized === false) return false;

  // Legacy grade (isFinalized undefined) — inspect the data
  const comps = g.components || [];
  if (comps.length > 0) {
    // Has components — finalized only if a 'final' component has a score
    return comps.some(c => c.type === 'final' && c.score != null);
  }
  // Legacy scores
  if (g.finalScore != null) return true;   // has finalScore → finalized
  if (g.quizScore != null || g.assignmentScore != null) return false; // partial only
  // Manual grade (no scores at all) → always finalized
  return true;
};

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Grade statistics (superadmin only أ¢â‚¬â€‌ all courses) أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
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

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Grade statistics for assigned courses (doctor / assistant / superadmin) أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
router.get('/statistics/my-courses', auth, isAdmin, async (req, res) => {
  try {
    // Use already-populated req.user أ¢â‚¬â€‌ no extra DB round-trip needed
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

    // أ¢â€‌â‚¬أ¢â€‌â‚¬ Get all assigned courses (even those with 0 grades) أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
    const courseQuery = scopedCourseIds ? { _id: { $in: scopedCourseIds } } : {};
    const allCourses = await Course.find(courseQuery)
      .select('_id courseCode courseName major year semester status')
      .lean();

    // أ¢â€‌â‚¬أ¢â€‌â‚¬ Get grade aggregates for courses that HAVE grades أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
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

    // أ¢â€‌â‚¬أ¢â€‌â‚¬ Merge: every course gets a stats row, zero-filled if no grades أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
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

    // أ¢â€‌â‚¬أ¢â€‌â‚¬ Grade distribution across all scoped courses أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
    const gradeDist = await Grade.aggregate([
      { $match: effectiveCourseFilter },
      { $group: { _id: '$grade', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // أ¢â€‌â‚¬أ¢â€‌â‚¬ Per-major stats أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
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

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Student's own grades أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
router.get('/student', auth, async (req, res) => {
  try {
    const grades = await Grade.find({ student: req.userId })
      .populate('course', 'courseCode courseName credits')
      .sort({ year: -1, semester: 1 })
      .lean();
    // For retake records: the F has been replaced by the new grade already.
    // isRetake=true just means the student previously failed أ¢â‚¬â€‌ the grade shown IS the new one.
    res.json(grades);
  } catch (error) {
    return sendError(res, 500, 'Error fetching grades', error);
  }
});

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Calculate GPA أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
// Skip: (1) records with no credits, (2) ungraded retake placeholders (isRetake=true, grade still F/0)
router.get('/gpa', auth, async (req, res) => {
  try {
    const grades = await Grade.find({ student: req.userId })
      .populate('course', 'credits').lean();
    if (grades.length === 0) return res.json({ gpa: 0, totalCredits: 0, partialCount: 0 });
    let totalPoints = 0, totalCredits = 0, partialCount = 0;
    grades.forEach(g => {
      if (!g.course?.credits) return;
      if (g.isRetake && g.gradePoint === 0 && g.grade === 'F') return;
      if (!isGradeFinalized(g)) { partialCount++; return; }
      totalPoints  += g.gradePoint * g.course.credits;
      totalCredits += g.course.credits;
    });
    if (totalCredits === 0) return res.json({ gpa: 0, totalCredits: 0, partialCount });
    res.json({ gpa: parseFloat((totalPoints / totalCredits).toFixed(2)), totalCredits, partialCount });
  } catch (error) {
    return sendError(res, 500, 'Error calculating GPA', error);
  }
});

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Grades by course أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
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

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Add / Update grade (staff: doctor/assistant/superadmin) أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
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

    // Priority: components أ¢â€ â€™ legacy scores أ¢â€ â€™ manual
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

    // أ¢â€‌â‚¬أ¢â€‌â‚¬ Check if this is a retake أ¢â‚¬â€‌ apply cap if so أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
    let existingGrade = await Grade.findOne({ student, course });
    const isRetake = existingGrade?.isRetake === true;

    if (isRetake && computedTotal != null) {
      // Cap computed total at 83 and recalculate grade
      const capped = applyRetakeCap(finalGrade, finalGradePoint, computedTotal);
      finalGrade      = capped.grade;
      finalGradePoint = capped.gradePoint;
    } else if (isRetake && finalGrade) {
      // Manual grade entry for retake أ¢â‚¬â€‌ cap gradePoint at B (3.0, corresponds to 83)
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

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Delete grade (superadmin only) أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
router.delete('/:id', auth, requireSuperAdmin, async (req, res) => {
  try {
    const grade = await Grade.findByIdAndDelete(req.params.id);
    if (!grade) return res.status(404).json({ message: 'Grade not found' });
    res.json({ message: 'Grade deleted successfully' });
  } catch (error) {
    return sendError(res, 500, 'Error deleting grade', error);
  }
});

// أ¢â€‌â‚¬أ¢â€‌â‚¬ Get grades for a specific student (staff) أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬أ¢â€‌â‚¬
router.get('/admin/student/:studentId', auth, isAdmin, async (req, res) => {
  try {
    const grades = await Grade.find({ student: req.params.studentId })
      .populate('course', 'courseCode courseName credits')
      .sort({ year: -1, semester: 1 });

    const filteredGrades = isSuperAdmin(req.user)
      ? grades
      : grades.filter(g => canAccessCourse(req, (g.course?._id || g.course)));

    // CGPA only from finalized grades (uses isGradeFinalized to handle old records)
    const finalizedGrades = filteredGrades.filter(g => isGradeFinalized(g));
    const totalWP = finalizedGrades.reduce((s, g) => s + (g.gradePoint * (g.course?.credits || 1)), 0);
    const totalCr = finalizedGrades.reduce((s, g) => s + (g.course?.credits || 1), 0);
    const cgpa = totalCr > 0 ? parseFloat((totalWP / totalCr).toFixed(2)) : 0;
    const partialCount = filteredGrades.filter(g => !isGradeFinalized(g)).length;

    res.json({ grades: filteredGrades, cgpa, totalGrades: filteredGrades.length, partialCount });
  } catch (error) {
    return sendError(res, 500, 'Error fetching student grades', error);
  }
});

module.exports = router;


