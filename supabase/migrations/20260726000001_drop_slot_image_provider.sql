-- D-6（案B）: 画像providerはアカウント設定（profiles.ai_purpose_config.image）を正とする。
-- schedule_slots.image_provider は保存されるだけで実行時に参照されず（executeImageGeneration は
-- resolveImageProvider でアカウント設定から解決する）、選んでも反映されない不整合の原因だった。
alter table schedule_slots drop constraint if exists schedule_slots_image_provider_valid;
alter table schedule_slots drop column if exists image_provider;
