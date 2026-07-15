import { SupabaseClient } from "@supabase/supabase-js"
import { Database } from "@/types/supabase"
import { DALError } from "@/dal /errors"

export async function assertWithinStudenLimit(
  db: SupabaseClient<Database>,
  schoolId: string
): Promise<void> {
  const {data: school} = await db
    .from('schools')
    .select('max_students, subscription_tier, subscription_status')
    .eq('id', schoolId)
    .single()
  if (!school)  throw new DALError('NOT_FOUND', 'School not found')
  if (school.subscription_status !== 'active') {
    throw new DALError(
      'SUBSCRIPTION_ERROR',
      'School subscription status was not active',

    )
  }
  const {count} = await db
    .from('students')
    .select('*', { count: 'exact', head: true})
    .eq('school_id', schoolId)
    .eq('enrollment_status', 'active')

  if ((count ?? 0) >= school.max_students){
    throw new DALError(
      'LIMIT_EXCEEDED',
      `students limit of  ${school.max_students} reached. Upgrade to add more students`
    )
  }



}
export async function assertSubscriptionActive(
  db: SupabaseClient<Database>,
  schoolId: string

): Promise<void> {
  const {data: school} = await db
    .from('schools')
  .select('subscription_status, subscription_ends_at, trial_ends_at')
    .eq('id', schoolId)
    .single()

  if (!school)  throw new DALError('NOT_FOUND', 'School not found')

  // check trial expiry
  if (school.trial_ends_at && new Date(school.trial_ends_at) < new Date()) {
    throw new DALError(
      'SUBSCRIPTION_EXPIRED',
      'Trial period has ended. Please subscribe to continue.'
    )
  }
  if (
    school.subscription_ends_at &&
    new Date(school.subscription_ends_at)  < new Date()

  ){
    throw new DALError(
      'SUBSCRIPTION_EXPIRED',
      'Subscription has expired. Please renew to continue .'

    )
  }
  if (school.subscription_status !== 'active') {
    throw new DALError(
      'SUBSCRIPTION_INACTIVE',
      `Subscription is ${school.subscription_status}`

    )
  }
}