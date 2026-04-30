import { SchoolContext, UserRole } from "@/lib/supabase/context"
import { logger } from "@/lib/logger"
import { DALError } from "@/dal /errors"

const ROLE_HIERACHY: UserRole[] = [
  'parent',
  'student',
  'admin',
  'principal',
  'teacher'
]
export const ADMIN_ROLES: UserRole[] = ['admin', 'principal']
export const STAFF_ROLES: UserRole[] = ['principal', 'teacher', 'admin']
export const ALL_ROLES: UserRole[] = ['admin', 'principal', 'teacher', 'admin', 'student', 'parent']

//Core guards

// throws if the users role is not allowed in the allowed list
//called at thestart of  every write server action

export function requireRole (
  userRole: UserRole,
  allowed: UserRole[]
): void {
  if (!allowed.includes(userRole)){
    logger.warn('guards', 'requireRole failed', {
      userRole,
      required: allowed,
    })
    throw new DALError(
      'UNAUTHORIZED',
      `Only ${allowed.join(' or ')} can perform this action — you are a ${userRole}`

    )
  }
}

/** throws if the user is not in the same school as the resource.
 * when verifying a specific resource belongs to the user's school.
 */
export function requireSameSchool(
  userSchoolId: string,
  resourceSchoolId: string
): void  {
  if (userSchoolId !== resourceSchoolId) {
    logger.warn('guards', 'requireSameSchool failed — cross-tenant access attempt', {
      userSchoolId,
      resourceSchoolId,
    })
    throw new DALError(
      'UNAUTHORIZED',
      'Cannot access resource from another school'
    )
  }
}

/**
 * Throws if the user is not the owner of the resource.
 * use for student/parent accessing their own records only.
 *
 */
export function requireOwnership(
  userId: string,
  resourceId: string,
  resource: string = 'resource'

): void  {
  if (userId !== resourceId) {
    logger.warn('guards', 'requireOwnership failed', {
      userId,
      resourceId,
      resource,
    })
    throw new DALError(
      'UNAUTHORIZED',
      `You do not have permission to access this ${resource}`
    )
  }
}
/**
 * Throws if the user does not have at least the minimum role level.
 * Based on role hierarchy: parent < student < teacher < principal < admin
 *
 * @example
 * requireMinRole(context.role, 'teacher')  // teacher, principal, admin pass
 */
export function requireMinRole(
  userRole: UserRole,
  minRole: UserRole
): void {
  const userLevel = ROLE_HIERACHY.indexOf(userRole)
  const minLevel = ROLE_HIERACHY.indexOf(minRole)

  if (userLevel < minLevel) {
    logger.warn('guards', 'requireMinRole failed', {
      userRole,
      minRole,
    })
    throw new DALError(
      'UNAUTHORIZED',
      `This action requires at least ${minRole} access`
    )
  }
}
// ── Convenience guards ────────────────────────────────────────────────

/**
 * Throws if the user is not an admin or principal.
 * Use for user creation, school settings, role changes.
 */
export function requireAdmin(role: UserRole): void {
  requireRole(role, ADMIN_ROLES)
}
/**
 * Throws if the user is not a teacher, admin, or principal.
 * Use for attendance, results, timetables.
 */
export function requireStaff(role: UserRole): void {
  requireRole(role, STAFF_ROLES)
}
/**
 * Throws if the user is not a student.
 * Use for student-only resources.
 */
export function requireAdminRole(role: UserRole): void {
  requireRole(role, ['student'])
}
/**
 * Throws if the user is not a parent.
 * Use for parent-only resources.
 */
export  function  requireParent(role: UserRole): void {
  requireRole(role, ['parent'])
}

// ── Composite guards ──────────────────────────────────────────────────

/**
 * Combines role check + school isolation in one call.
 * Use when you need both checks together.
 *
 * @example
 * requireRoleAndSchool(context, ['teacher'], student.school_id)
 */
export function requireRoleAndSchool(
  context: SchoolContext,
  allowed: UserRole[],
  resourceSchoolId: string
): void {
  requireRole(context.role, allowed)
  requireSameSchool(context.schoolId, resourceSchoolId)
}
/**
 * Allows access if the user is staff OR if they own the resource.
 * Use for resources that staff manage but owners can also view.
 *
 * @example
 * // Teacher can view any student's result, student can only view own
 * requireStaffOrOwner(context, result.student_id)
 */
export function requireStaffOrOwner(
  context: SchoolContext,
  ownerId: string,
  resource: string = 'resource'

): void {
  const isStaff = STAFF_ROLES.includes(context.role)
  const isOwner = context.userId === ownerId

  if (!isStaff && !isOwner) {
    logger.warn('guards', 'requireOwnership failed', {
      role: context.role,
      userId: context.userId,
      ownerId,
      resource,
    })
    throw new DALError(
      'UNAUTHORISED',
      `You do not have permission to access this ${resource}`
    )

  }
}
/**
 * Allows access if the user is admin OR if they are the resource owner.
 * Use for profile updates — admin can edit anyone, user can edit themselves.
 *
 * @example
 * requireAdminOrOwner(context, profile.id)
 */
export function requireAdminOrOwner(
  context: SchoolContext,
  ownerId: string,
  resource: string = 'resource'

): void {
  const isAdmin = ADMIN_ROLES.includes(context.role)
  const isOwner = context.userId === ownerId

  if (!isAdmin && !isOwner) {
    logger.warn('guards', 'requireAdmin failed', {
      role: context.role,
      userId: context.userId,
      ownerId,
      resource,
    })
    throw new DALError(
      'UNAUTHORIZED',
      `access denied for ${resource}`
    )
  }
}
/**
 * Allows parent access only if the student is linked to them.
 * Use for all parent-facing student data queries.
 *
 * @example
 * requireParentOwnsStudent(context.role, linkedStudentIds, studentId)
 */
export function requireParentOwnsStudent(
  role: UserRole,
  linkedStudentIds: string[],
  studentId: string

): void {
  // Staff can always access
  if (STAFF_ROLES.includes(role)) return
   //Students can access their own data -
  if (role === 'student')  return
  //Parents must have the student linked
  if (role === 'parent' && !linkedStudentIds.includes(studentId)){
    logger.warn('guards', 'requireParentOwnsStudent failed',{
      studentId,
      linkedCount: linkedStudentIds.length,
    })
    throw new DALError(
    'UNAUTHORIZED',
      'You are not linked to this student'
    )
  }
  if (role === 'parent' && linkedStudentIds.includes(studentId)) return
  throw new DALError('UNAUTHORIZED', 'Access denied')

}


