import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 测试临时目录生命周期的唯一事实源。
 *
 * 背景：全仓曾有 134 处测试用裸 `fs.rm(root, { recursive: true, force: true })`
 * 清理临时目录。Windows 上防病毒扫描或搜索索引器会短暂持有目录内文件句柄，导致
 * rm 抛 ENOTEMPTY / EPERM / EBUSY，测试因清理失败被标记为假失败——代码没有问题，
 * 但套件偶发变红。带重试的删除让清理在句柄释放后收敛。
 *
 * 结构守卫 `source-test-directory-cleanup-structure.test.ts` 禁止测试文件再使用
 * 裸 rm 形式，新测试必须使用本模块。
 */

/** 创建带唯一后缀的测试临时目录。 */
export async function makeTestDirectory(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** 删除测试目录；对 Windows 句柄占用做重试，force 语义下目录不存在不报错。 */
export async function removeTestDirectory(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
