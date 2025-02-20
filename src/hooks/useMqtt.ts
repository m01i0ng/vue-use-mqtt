import type { IClientOptions, ISubscriptionMap, MqttClient, Packet } from 'mqtt'
import type { QoS } from 'mqtt-packet'
import type { Ref } from 'vue'
import mqtt from 'mqtt'
import { onUnmounted, reactive, ref, shallowRef, watchEffect } from 'vue'

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
type SubscribeTopic = string | string[] | ISubscriptionMap
export type MessageHandler = (topic: string, message: Buffer, packet: Packet) => void

interface MqttOptions extends IClientOptions {
  autoReconnect?: boolean
  reconnectInterval?: number
  maxReconnectAttempts?: number
}

interface UseMqttReturn {
  client: Ref<MqttClient | null>
  connectionState: Ref<ConnectionState>
  subscribeTopics: Set<string>
  error: Ref<Error | null>
  connect: () => void
  disconnect: () => void
  publish: (topic: string, message: string | Buffer, qos?: QoS) => void
  subscribe: (topics: SubscribeTopic) => void
  unsubscribe: (topics: string | string[]) => void
}

export function useMqtt(
  brokerUrl: string,
  options: MqttOptions = {},
  onMessage: MessageHandler = () => {},
): UseMqttReturn {
  const client = shallowRef<MqttClient | null>(null)
  const connectionState = ref<ConnectionState>('disconnected')
  const subscribeTopics = reactive<Set<string>>(new Set())
  const error = ref<Error | null>(null)
  const isManualDisconnect = ref(false)
  let reconnectTimer: NodeJS.Timeout | null = null

  const defaultOptions: MqttOptions = {
    keepalive: 30,
    protocolVersion: 4,
    reconnectPeriod: 5000,
    connectTimeout: 30 * 1000,
    autoReconnect: true,
    maxReconnectAttempts: 5,
    ...options,
  }

  const handleConnect = () => {
    connectionState.value = 'connected'
    error.value = null
    Array.from(subscribeTopics).forEach((topic) => {
      client.value?.subscribe(topic)
    })
  }

  const handleError = (err: Error) => {
    error.value = err
    if (defaultOptions.autoReconnect && !isManualDisconnect.value) {
      connectionState.value = 'reconnecting'
      scheduleReconnect()
    }
  }

  let reconnectAttempts = 0

  const scheduleReconnect = () => {
    if (reconnectAttempts >= defaultOptions.maxReconnectAttempts!) {
      error.value = new Error('Max reconnect attempts reached')
      return
    }

    const delay = Math.min(5000 * 2 ** reconnectAttempts, 30000)
    reconnectAttempts++

    reconnectTimer = setTimeout(() => {
      connect()
      reconnectAttempts = 0
    }, delay)
  }

  const connect = () => {
    const cleanup = () => {
      client.value?.removeAllListeners('connect')
      client.value?.removeAllListeners('message')
      client.value?.removeAllListeners('error')
      client.value?.removeAllListeners('close')
    }

    if (client.value?.connected)
      return

    isManualDisconnect.value = false
    connectionState.value = 'connecting'
    cleanup()
    client.value = mqtt.connect(brokerUrl, defaultOptions)

    client.value.on('connect', handleConnect)
    client.value.on('message', onMessage)
    client.value.on('error', handleError)
    client.value.on('close', () => {
      connectionState.value = 'disconnected'
      if (defaultOptions.autoReconnect && !isManualDisconnect.value) {
        scheduleReconnect()
      }
    })
  }

  const disconnect = () => {
    isManualDisconnect.value = true
    if (client.value?.connected) {
      client.value.end(false, () => {
        connectionState.value = 'disconnected'
      })
    }
  }

  const publish = (topic: string, message: string | Buffer, qos?: QoS) => {
    if (client.value?.connected) {
      client.value.publish(topic, message, { qos }, (err) => {
        if (err)
          error.value = err
      })
    }
  }

  const subscribe = (topics: SubscribeTopic) => {
    if (typeof topics === 'string') {
      subscribeTopics.add(topics)
    }
    else if (Array.isArray(topics)) {
      topics.forEach(topic => subscribeTopics.add(topic))
    }
    else {
      Object.keys(topics).forEach(topic => subscribeTopics.add(topic))
    }

    if (client.value?.connected) {
      client.value.subscribe(topics, (err) => {
        if (err)
          error.value = err
      })
    }
  }

  const unsubscribe = (topics: string | string[]) => {
    const topicsArray = Array.isArray(topics) ? topics : [topics]
    topicsArray.forEach(topic => subscribeTopics.delete(topic))
    if (client.value?.connected) {
      client.value.unsubscribe(topicsArray, (err) => {
        if (err)
          error.value = err
      })
    }
  }

  watchEffect(() => {
    if (client.value) {
      client.value.off('message', onMessage)
      client.value.on('message', onMessage)
    }
  })

  onUnmounted(() => {
    disconnect()
    if (reconnectTimer)
      clearTimeout(reconnectTimer)
    client.value?.removeAllListeners()
    client.value = null
  })

  return {
    client,
    connectionState,
    subscribeTopics,
    error,
    connect,
    disconnect,
    publish,
    subscribe,
    unsubscribe,
  }
}
