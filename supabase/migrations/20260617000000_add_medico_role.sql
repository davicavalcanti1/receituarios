-- Adiciona role 'medico' ao enum app_role (IF NOT EXISTS — idempotente)
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'medico';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
