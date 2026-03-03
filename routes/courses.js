const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const User = require('../models/User');
const Grade = require('../models/Grade');
const { auth, isAdmin, requireSuperAdmin, isSuperAdmin } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');

// Helper: calculate CGPA + enrolled credits in ONE query pass
const getStudentCreditInfo = async (studentId) => {
  const [grades, user] = await Promise.all([
    Grade.find({ student: studentId }).select('gradePoint grade course isRetake').populate('course', 'credits').lean(),
    User.findById(studentId).select('enrolledCourses').populate('enrolledCourses', '_id credits').lean(),
  ]);
  let totalPoints = 0, totalCredits = 0;
  const gradedIds = new Set();
  (grades || []).forEach(g => {
    if (g.course?._id) gradedIds.add(g.course._id.toString());
    if (!g.course?.credits) return;
    if (g.isRetake && g.gradePoint === 0 && g.grade === 'F') return;
    totalPoints  += g.gradePoint * g.course.credits;
    totalCredits += g.course.credits;
  });
  const cgpa = totalCredits > 0 ? parseFloat((totalPoints / totalCredits).toFixed(2)) : 0;
  let currentCredits = 0;
  (user?.enrolledCourses || []).forEach(c => {
    if (!gradedIds.has(c._id.toString())) currentCredits += (c.credits || 0);
  });
  const realGradeCount = (grades || []).filter(g => !(g.isRetake && g.gradePoint === 0 && g.grade === 'F')).length;
  return { cgpa, currentCredits, hasNoGrades: realGradeCount === 0 };
};

// Helper function to get credit hours limit based on CGPA
// Year-1 students with no grades yet (first term) always get 21 hours
const getCreditHoursLimit = (cgpa, hasNoGrades = false) => {
  if (hasNoGrades) return 21;  // First-term Year-1: open enrolment up to 21 hrs
  if (cgpa >= 3.0) return 21;  // Good Standing / Satisfactory
  if (cgpa >= 2.0) return 15;  // Pass
  if (cgpa >= 1.0) return 12;  // Below Average
  return 9;                    // Probation
};

// Get student's credit hours eligibility
router.get('/eligibility/credit-hours', auth, async (req, res) => {
  try {
    const { cgpa, currentCredits, hasNoGrades } = await getStudentCreditInfo(req.userId);
    const creditLimit = getCreditHoursLimit(cgpa, hasNoGrades);
    let status = 'Probation';
    if (hasNoGrades)      status = 'First Term';
    else if (cgpa >= 3.4) status = 'Good Standing';
    else if (cgpa >= 3.0) status = 'Satisfactory';
    else if (cgpa >= 2.0) status = 'Pass';
    else if (cgpa >= 1.0) status = 'Below Average';
    res.json({
      cgpa, status, creditLimit, currentCredits,
      availableCredits: creditLimit - currentCredits,
      canEnroll: currentCredits < creditLimit,
      eligibilityRules: {
        'First Term (no grades yet)': 21,
        'Good Standing (CGPA â‰¥ 3.4)': 21,
        'Satisfactory (CGPA â‰¥ 3.0)': 21,
        'Pass (CGPA â‰¥ 2.0)': 15,
        'Below Average (CGPA â‰¥ 1.0)': 12,
        'Probation (CGPA < 1.0)': 9
      }
    });
  } catch (error) {
    return sendError(res, 500, 'Error fetching credit hours eligibility', error);
  }
});

// Get all courses â€” students only see Shared + their major; admins see all
router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('role major').lean();
    let filter = {};
    if (user.role === 'student') {
      filter = {
        status: { $ne: 'completed' },
        $or: [{ major: 'Shared' }, { major: user.major }, { major: null }, { major: '' }]
      };
    }
    const courses = await Course.find(filter).lean();
    res.json(courses);
  } catch (error) {
    return sendError(res, 500, 'Error fetching courses', error);
  }
});

// Get student's enrolled courses
router.get('/enrolled', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate('enrolledCourses');
    res.json(user.enrolledCourses);
  } catch (error) {
    return sendError(res, 500, 'Error fetching enrolled courses', error);
  }
});

// Get course by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }
    res.json(course);
  } catch (error) {
    return sendError(res, 500, 'Error fetching course', error);
  }
});

// Create course (superadmin only)
router.post('/', auth, requireSuperAdmin, async (req, res) => {
  try {
    const course = new Course(req.body);
    await course.save();
    res.status(201).json(course);
  } catch (error) {
    return sendError(res, 500, 'Error creating course', error);
  }
});

// Enroll in course
router.post('/:id/enroll', auth, async (req, res) => {
  try {
    // Run course + user + grade lookups in parallel
    const [course, user, existingGrade, realGradeCount] = await Promise.all([
      Course.findById(req.params.id).lean(),
      User.findById(req.userId).populate('enrolledCourses', '_id credits'),
      Grade.findOne({ student: req.userId, course: req.params.id }),
      Grade.countDocuments({
        student: req.userId,
        $nor: [{ isRetake: true, gradePoint: 0, grade: 'F' }]
      }),
    ]);

    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (course.status === 'completed')
      return res.status(400).json({ message: 'This course has been completed and is no longer open for enrollment.' });

    const courseIsShared = !course.major || course.major === 'Shared' || course.major === 'shared';
    if (!courseIsShared && course.major !== user.major)
      return res.status(403).json({ message: `This course is only available for ${course.major} students.` });

    const alreadyEnrolled = user.enrolledCourses.some(c => c._id.toString() === req.params.id);
    if (alreadyEnrolled) return res.status(400).json({ message: 'Already enrolled in this course' });

    // Calculate CGPA and credits in parallel from already-fetched data
    const gradesForCGPA = await Grade.find({ student: req.userId })
      .select('gradePoint course isRetake grade').populate('course', 'credits').lean();

    let totalPoints = 0, totalCredits = 0;
    const gradedCourseIds = new Set();
    gradesForCGPA.forEach(g => {
      gradedCourseIds.add(g.course?._id?.toString());
      if (!g.course?.credits) return;
      if (g.isRetake && g.gradePoint === 0 && g.grade === 'F') return;
      totalPoints  += g.gradePoint * g.course.credits;
      totalCredits += g.course.credits;
    });
    const cgpa = totalCredits > 0 ? parseFloat((totalPoints / totalCredits).toFixed(2)) : 0;
    const hasNoGrades = realGradeCount === 0;
    const creditLimit = getCreditHoursLimit(cgpa, hasNoGrades);

    // Current enrolled credits (exclude already-graded courses)
    let currentCredits = 0;
    user.enrolledCourses.forEach(c => {
      if (!gradedCourseIds.has(c._id.toString())) currentCredits += (c.credits || 0);
    });

    if (currentCredits + course.credits > creditLimit) {
      return res.status(400).json({
        message: 'Cannot enroll: Credit hours limit exceeded',
        details: { cgpa, creditLimit, currentCredits, courseCredits: course.credits, wouldBe: currentCredits + course.credits, available: creditLimit - currentCredits }
      });
    }

    if (existingGrade && existingGrade.gradePoint >= 2.0)
      return res.status(400).json({ message: 'You have already completed this course', grade: existingGrade.grade });

    const isRetake = existingGrade && existingGrade.grade === 'F';
    if (isRetake) {
      Object.assign(existingGrade, {
        isRetake: true, previousGrade: existingGrade.grade,
        retakeAttempt: (existingGrade.retakeAttempt || 1) + 1,
        grade: 'F', gradePoint: 0,
        quizScore: null, assignmentScore: null, finalScore: null, components: []
      });
      await existingGrade.save();
    }

    // Check prerequisites
    if (course.prerequisites && course.prerequisites.length > 0) {
      const passedGrades = await Grade.find({ student: req.userId, gradePoint: { $gte: 1.0 } })
        .populate('course', 'courseName courseCode').lean();
      const passedNames = passedGrades.map(g => g.course?.courseName?.toLowerCase().trim()).filter(Boolean);
      const passedCodes = passedGrades.map(g => g.course?.courseCode?.toLowerCase().trim()).filter(Boolean);
      const unmet = course.prerequisites.filter(p => {
        const lower = p.toLowerCase().trim();
        if (lower.includes('level') || lower.includes('credit') || lower.includes('completed')) return false;
        return !passedNames.includes(lower) && !passedCodes.includes(lower);
      });
      if (unmet.length > 0) return res.status(400).json({ message: 'Prerequisites not met', unmetPrerequisites: unmet });
    }

    // Save enrollment in parallel
    await Promise.all([
      User.findByIdAndUpdate(req.userId, { $addToSet: { enrolledCourses: course._id } }),
      Course.findByIdAndUpdate(req.params.id, { $addToSet: { enrolledStudents: req.userId } }),
    ]);

    const newTotal = currentCredits + course.credits;
    res.json({
      message: isRetake ? `Re-enrolled in ${course.courseName}. Note: maximum grade is capped at 83 (B).` : 'Successfully enrolled in course',
      isRetake,
      courseDetails: { courseName: course.courseName, credits: course.credits },
      creditStatus: { cgpa, creditLimit, currentCredits: newTotal, remaining: creditLimit - newTotal }
    });
  } catch (error) {
    return sendError(res, 500, 'Error enrolling in course', error);
  }
});


// Mark course as ended / reactivate (superadmin or doctor with canMarkCourseStatus permission)
router.patch('/:id/status', auth, isAdmin, async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      if (req.user.permissions?.canMarkCourseStatus === false) {
        return res.status(403).json({ message: 'You do not have permission to change course status' });
      }
      const assigned = (req.user.assignedCourses || []).map(c => (c._id || c).toString());
      if (!assigned.includes(req.params.id)) {
        return res.status(403).json({ message: 'You do not have access to this course' });
      }
    }
    const { status } = req.body;
    if (!['active', 'completed'].includes(status)) {
      return res.status(400).json({ message: 'Status must be "active" or "completed"' });
    }
    const course = await Course.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!course) return res.status(404).json({ message: 'Course not found' });
    res.json({ message: `Course marked as ${status}`, course });
  } catch (error) {
    return sendError(res, 500, 'Error updating course status', error);
  }
});

// Update course (superadmin: all; doctor/assistant: own assigned + canEditCourse permission)
router.put('/:id', auth, isAdmin, async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      if (req.user.permissions?.canEditCourse === false) {
        return res.status(403).json({ message: 'You do not have permission to edit courses' });
      }
      const assigned = (req.user.assignedCourses || []).map(c => (c._id || c).toString());
      if (!assigned.includes(req.params.id)) {
        return res.status(403).json({ message: 'You do not have access to this course' });
      }
    }
    const course = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!course) return res.status(404).json({ message: 'Course not found' });
    res.json(course);
  } catch (error) {
    return sendError(res, 500, 'Error updating course', error);
  }
});

// Delete course (superadmin only)
router.delete('/:id', auth, requireSuperAdmin, async (req, res) => {
  try {
    const course = await Course.findByIdAndDelete(req.params.id);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }
    res.json({ message: 'Course deleted successfully' });
  } catch (error) {
    return sendError(res, 500, 'Error deleting course', error);
  }
});


module.exports = router;

