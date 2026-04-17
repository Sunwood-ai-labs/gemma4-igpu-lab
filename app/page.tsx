import { LlamaSpeedLab } from "@/components/llama-speed-lab";
import { getDefaultServerConfig } from "@/lib/llama-server";

export default function HomePage() {
  return <LlamaSpeedLab initialConfig={getDefaultServerConfig()} />;
}
