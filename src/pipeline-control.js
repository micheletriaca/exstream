const pipelineInstantiators = new WeakMap()

const registerPipeline = (pipeline, instantiate) => {
  pipelineInstantiators.set(pipeline, instantiate)
  return pipeline
}

const instantiatePipeline = (pipeline) => pipelineInstantiators.get(pipeline)()

module.exports = { instantiatePipeline, registerPipeline }