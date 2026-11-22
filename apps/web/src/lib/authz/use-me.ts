import { useSuspenseQuery } from '@tanstack/react-query';
import { meReadOptions } from '../api';

/**
 * The signed-in user, their academies and their permissions.
 *
 * Only for components under the `_app` layout route, whose `beforeLoad` has already
 * loaded `/me`: the query is in the cache, so this never suspends there.
 */
export function useMe() {
  return useSuspenseQuery(meReadOptions()).data;
}
