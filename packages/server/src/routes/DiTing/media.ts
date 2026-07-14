import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/media'

export const mediaRoutes = new Router()

mediaRoutes.post('/api/DiTing/media/grok-image-to-video', ctrl.grokImageToVideo)
mediaRoutes.post('/api/DiTing/media/apikey-image-generate', ctrl.apiKeyImageGenerate)
