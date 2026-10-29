export default class NoElk {
  layout(): Promise<never> {
    return Promise.reject(new Error("the ELK layout isn't included here: drop `layout: elk` to draw this diagram"))
  }
}
