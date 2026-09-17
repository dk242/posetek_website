"""Authorization for reviewed web plans; individual-workout/native policy stays separate."""
from gateway.authz import authorize_v3
from gateway.errors import permission_denied

CAPABILITIES = frozenset(('generate_personalized_plan', 'assess_personalized_plan',
                         'activate_personalized_plan', 'discard_personalized_plan'))


def authorize_personalized(inv, read=None, draft=None):
    # Strict v3 read/generation authority already resolves current club assignment
    # transactionally. mutation=True is deliberately narrower for workout edits.
    if (inv.trusted_claims or {}).get('firebase', {}).get('sign_in_provider') == 'anonymous':
        raise permission_denied('A registered account is required')
    role = authorize_v3(inv, mutation=False, read=read)
    if draft is not None and role != 'admin' and draft.get('createdByUid') != inv.uid:
        raise permission_denied('Only the requesting account may review this draft')
    from gateway.personalized_jobs import assert_execution
    assert_execution(inv, read=read)
    return role
