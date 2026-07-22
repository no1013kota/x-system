-- T-M1-02: create a profile projection for every new Supabase Auth user.
-- A failed trigger blocks signup, so keep this function deterministic and free
-- of external calls. The login-time repair path in application code covers
-- legacy/missing rows without changing existing profile values.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    email,
    plan,
    subscription_status,
    ai_purpose_config,
    news_config,
    notification_config
  )
  values (
    new.id,
    new.email,
    'standard'::public.plan_type,
    'incomplete'::public.subscription_status,
    '{"text": null, "image": null}'::jsonb,
    '{"categories": ["ai", "web3", "investment", "business", "business_ops", "sns"], "impact_filter": ["high", "mid"], "max_items": 20}'::jsonb,
    '{"news": {"in_app": true, "email": true}, "draft_created": {"in_app": true, "email": true}, "posted": {"in_app": true, "email": false}, "error": {"in_app": true, "email": true}, "billing": {"in_app": true, "email": true}, "usage": {"in_app": true, "email": true}}'::jsonb
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- The application repair path uses the server-only service-role client.
grant select, insert, update, delete on table public.profiles to service_role;
