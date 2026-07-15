import { listDiTingPlugins } from '../../services/DiTing/plugins'

export async function list(ctx: any) {
  try {
    ctx.body = await listDiTingPlugins(ctx.state?.profile?.name)
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err.message || 'Failed to discover DiTing plugins' }
  }
}
