import { redirect } from "next/navigation";

// 词群页已并入「闪卡」页的「按主题」视图，这里重定向过去，避免旧链接 404。
export default function GroupsPage() {
  redirect("/cards?view=theme");
}
