// src/dal/index.ts

// ── Repositories ──────────────────────────────────────────────────────
export { TeachersRepository } from "./teachers.repository"
export { ClassesRepository } from "./classes.repository"
export { SchoolsRepository } from "./schools.repository"
export { ProfilesRepository } from "./profiles.repository"
export { AttendanceRepository } from "./attendance.repository"
export { ResultsRepository } from "./results.repository"
export { TimetablesRepository } from "./timetables.repository"
export { AnnouncementsRepository } from "./announcements.repository"
export { ActivitiesRepository } from "./activities.repository"
export { ActivityParticipantsRepository } from "./activity_participants.repository"
export { AchievementsRepository } from "./achievements.repository"
export { AuditLogsRepository } from "./audit-logs.repository"

// ── Base ──────────────────────────────────────────────────────────────
export { BaseRepository } from "./base.repository"

// ── Errors ────────────────────────────────────────────────────────────
export {
  DALError,
  NotFoundError,
  ValidationError,
  ConflictError,
  DatabaseError,
  UnauthorizedError,
  toHttpStatus,
} from "./errors"

// ── Guards ────────────────────────────────────────────────────────────
export {
  requireRole,
  requireSameSchool,
  requireOwnership,
  requireMinRole,
  requireAdmin,
  requireStaff,
  requireStudent,
  requireParent,
  requireRoleAndSchool,
  requireStaffOrOwner,
  requireAdminOrOwner,
  requireParentOwnsStudent,
  ADMIN_ROLES,
  STAFF_ROLES,
  ALL_ROLES,
} from "./guards"

// ── Audit constants ───────────────────────────────────────────────────
export { AUDIT_ACTIONS, RESOURCE_TYPES } from "./audit-logs.repository"

// ── Types ─────────────────────────────────────────────────────────────
export type {
  AuditAction,
  ResourceType,
  AuditLogInput,
} from "./audit-logs.repository"
export type {
  InternalStudentInput,
  InternalStudentUpdate,
  InternalStudentEnrollmentUpdate,
  InternalConsentUpdate,
  InternalPrivacyUpdate,
  InternalStudentSISUpdate,
  ListStudentsOptions,
  PaginatedStudents,
} from "./student.repository"
export type {
  InternalClassInput,
  InternalClassUpdate,
  InternalClassTeacherUpdate,
  InternalClassStatusUpdate,
  InternalClassSISUpdate,
  ListClassesOptions,
  PaginatedClasses,
} from "./classes.repository"
export type {
  InternalTeacherInput,
  InternalTeacherUpdate,
  InternalEmploymentUpdate,
  InternalHRUpdate,
  InternalBackgroundCheckUpdate,
  InternalSISUpdate,
  ListTeachersOptions,
  PaginatedTeachers,
} from './teachers.repository'
export type {
  ListAttendanceOptions,
  InternalAttendanceInput,
  InternalAttendanceUpdate,
} from "./attendance.repository"
export type {
  ListResultsOptions,
  InternalResultInput,
  InternalResultUpdate,
  InternalPostUpdate,
  InternalRetractUpdate,

} from "./results.repository"
export type {
  ListReportCardsOptions,
  CreateReportCardInput,
  UpdateReportCardInput,
} from "./report_card.repository"
export type {
  ListAnnouncementsOptions,
  CreateAnnouncementInput,
} from "./announcements.repository"
export type {
  ListActivitiesOptions,
  InternalActivityUpdate,
  InternalActivityInput,
  InternalPublishUpdate,
  InternalEnrollmentStatusUpdate,
} from "./activities.repository"
export type {
  ListAchievementsOptions,
  InternalAchievementInput,
  InternalAchievementUpdate,
  InternalVerificationUpdate,
  InternalVisibilityUpdate,
  InternalArrayUpdate,
} from "./achievements.repository"
export type {
  ListParticipantsOptions,
  InternalEnrollInput,
  InternalEnrollmentUpdate,
  InternalAssessmentUpdate,
  InternalCertificateUpdate,

} from "./activity_participants.repository"
export type {
  ListProfilesOptions,
  InternalProfileInput,
  InternalProfileUpdate,
  InternalLastLoginUpdate,
} from "./profiles.repository"
